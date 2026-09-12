import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
// SDK 是 ESM-only 包，主进程是 CommonJS：类型走静态导入（tsc 擦除），
// 值（DeepSeekHarness/TransportClosedError）在首次启动运行时动态 import。
import type {
  DeepSeekHarness,
  DeepSeekHarnessOptions,
  HarnessNotification,
  HarnessSession,
} from '@deepseek-ai/dsh-sdk-client';
import { writeAgentToolManifest } from './agentToolManifest';
import { readHarnessModelConfig, seedHarnessModelConfig } from './dshConfig';

type SdkModule = typeof import('@deepseek-ai/dsh-sdk-client');
let sdkModule: SdkModule | null = null;
async function loadSdk(): Promise<SdkModule> {
  if (!sdkModule) sdkModule = await import('@deepseek-ai/dsh-sdk-client');
  return sdkModule;
}

/**
 * 内置 Agent 运行时（DeepSeek Harness，子进程嵌入）。
 *
 * 主进程通过官方 SDK（stdio JSON-RPC）拉起 `dsh --profile sdk`，不开端口。
 * - 子进程惰性启动、跨请求复用；崩溃或 TransportClosedError 后下次调用自动重建。
 * - API Key 经 env 注入子进程（DEEPSEEK_API_KEY），不落盘；重置 key 后调用 `restart()`。
 * - SDK 无"轮次中取消"协议：UI 的"停止"= restart() 重建运行时，会话历史保留在 DSH_HOME。
 * - 依赖处于开发者预览期：版本钉死在 package.json，全部接触面收敛在本文件。
 */

export interface DshRuntimeDeps {
  /** 当前工作台根目录（dsh 会话 cwd） */
  workspaceRoot: () => string;
  /** 读取 API Key（safeStorage 解密结果），仅在启动子进程时调用 */
  getApiKey: () => string;
  /** 用户在 AI 设置里配置的网关地址与模型；Agent 复用同一路由（以自定义 provider 形式喂给 dsh） */
  getModelConfig?: () => { baseUrl: string; model: string } | null;
/** dsh 运行时 home（会话/设置持久化目录） */
  homeDir: string;
  /** 拉起 dsh 的 Node 可执行文件；默认 PATH 中的 node，打包后指向内置 Node */
  nodeCommand?: string;
  /** `dsh` CLI 入口（lib/bin.js）绝对路径；默认从 node_modules 解析 */
  dshBin?: string;
  /** 模型路由，缺省用 dsh 默认 */
  model?: string;
  /** provider 路由，默认 deepseek-official */
  provider?: string;
  /** 内置 Agent 的数据回调端点（暮雨笺内部 Bridge，启动子进程前读取） */
  getBridgeEndpoint?: () => Promise<{ url: string; token: string }>;
  /** 业务工具插件源码目录（plugins/muyujian-dsh-tools），打包后在 resources 下 */
  pluginDir?: string;
  /** 测试注入点：替换运行时工厂，默认 new DeepSeekHarness */
  harnessFactory?: (options: DeepSeekHarnessOptions) => DeepSeekHarness;
  /** 测试注入点：替换 dsh profile 准备（插件同步/patch），默认真实实现 */
  prepareProfile?: (homeDir: string) => Promise<string[]>;
  log?: (line: string) => void;
}

export type { DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client';

export interface DshRunResult {
  sessionId: string;
  finalResponse: string;
}

/** dsh sdk profile 的自定义 provider 名；模型走用户在 AI 设置里选的网关，统一为 openai-completions 协议。 */
export const MUYUJIAN_PROVIDER_ID = 'muyujian-gateway';

export class DshRuntime {
  private harness: DeepSeekHarness | null = null;
  private startTask: Promise<void> | null = null;

  constructor(private deps: DshRuntimeDeps) {}

  /** 是否已有存活运行时（仅用于状态展示）。 */
  isRunning(): boolean {
    return Boolean(this.harness);
  }

  /**
   * 在指定会话上执行一轮提示词。
   * `onNotification` 透传该会话树的全部流式通知（session.event / session.status 等）。
   */
  async run(
    sessionId: string | undefined,
    input: string,
    onNotification: (notification: HarnessNotification) => void,
  ): Promise<DshRunResult> {
    await this.ensureStarted();
    const harness = this.harness!;
    let session: HarnessSession;
    try {
      session = harness.session(sessionId);
      const result = await session.run(input, { onNotification });
      return { sessionId: result.sessionId, finalResponse: result.finalResponse };
    } catch (error) {
      // 运行时死了：丢弃句柄，下次调用重建（会话历史在 DSH_HOME，重开仍在）
      const closed = sdkModule?.TransportClosedError;
      if ((closed && error instanceof closed) || (error as Error)?.name === 'TransportClosedError') {
        await this.dropRuntime();
      }
      throw error;
    }
  }

  /** 重建运行时 = 当前协议下的"取消/停止"。 */
  async restart(): Promise<void> {
    await this.dropRuntime();
  }

  /** 应用退出时调用；幂等。 */
  async close(): Promise<void> {
    await this.dropRuntime();
  }

  private async ensureStarted(): Promise<void> {
    if (this.harness) return;
    if (this.startTask) return this.startTask;
    this.startTask = (async () => {
      const deps = this.deps;
      // 配置唯一事实源 = dsh home（settings.yaml + .credentials.yaml）；旧版应用配置只做一次性播种
      const legacy = deps.getModelConfig?.();
      let legacyKey: string | null = null;
      try { legacyKey = deps.getApiKey() || null; } catch { /* 没有旧版 key 时不阻断 */ }
      if (legacy) {
        try { seedHarnessModelConfig(deps.homeDir, { baseUrl: legacy.baseUrl, model: legacy.model, apiKey: legacyKey }); } catch { /* 播种失败不阻断启动 */ }
      } else {
        // 保底：完全没有旧配置时也确保 settings.yaml 结构存在
      }
      const harnessConfig = readHarnessModelConfig(deps.homeDir);
      const apiKey = harnessConfig?.apiKey ?? legacyKey ?? '';
      if (!apiKey) throw new Error('请先在 Agent 页的配置（DeepSeek Harness 设置）中保存 API Key');
      // 工作区路径先落为长路径真实形态：Windows 上中文目录可能以 8.3 短名进入子进程，
      // 短名换算会丢字符导致 dsh 记录的工作区"不存在"。
      const workspaceRoot = toLongRealPath(deps.workspaceRoot());
      const resolved = resolveDshRuntimePaths();
      const dshBin = deps.dshBin ?? resolved.dshBin;
      const nodeCommand = deps.nodeCommand ?? resolved.nodeCommand;
      const prepare = deps.prepareProfile ?? ((home: string) => prepareSdkProfile(home, {
        nodeCommand,
        dshBin,
        pluginDir: deps.pluginDir ?? defaultPluginDir(),
      }));
      const extraArgs = await prepare(deps.homeDir);
      const bridge = deps.getBridgeEndpoint ? await deps.getBridgeEndpoint() : null;
      const manifestFile = writeAgentToolManifest(deps.homeDir, deps.workspaceRoot);
      const modelConfig = harnessConfig;
      const sdk = deps.harnessFactory ? null : await loadSdk();
      const create = deps.harnessFactory ?? ((options: DeepSeekHarnessOptions) => new sdk!.DeepSeekHarness(options));
      const harness = create({
        launch: {
          command: nodeCommand,
          args: [dshBin, '--profile', 'sdk', ...extraArgs],
          cwd: workspaceRoot,
          env: {
            ...process.env,
            DSH_HOME: deps.homeDir,
            DEEPSEEK_API_KEY: apiKey,
            MUYUJIAN_LLM_API_KEY: apiKey,
            // 本机可能有系统代理，回调/本机地址必须绕过
            NO_PROXY: '127.0.0.1,localhost',
            no_proxy: '127.0.0.1,localhost',
            MUYUJIAN_TOOL_MANIFEST: manifestFile,
            MUYUJIAN_DSH_TOOLS_PATH: resolveDshToolsDir(dshBin),
            ...(bridge ? { MUYUJIAN_BRIDGE_URL: bridge.url, MUYUJIAN_BRIDGE_TOKEN: bridge.token } : {}),
          },
        },
        cwd: workspaceRoot,
        // provider 以 dsh home 里的实际配置为准（用户在 GUI 里可能改过 providerId）
        provider: deps.provider ?? modelConfig?.providerId,
        model: deps.model ?? modelConfig?.model,
      });
      try {
        await harness.start();
      } catch (error) {
        await harness.close().catch(() => {});
        throw error;
      }
      this.harness = harness;
      this.deps.log?.(`dsh runtime started (home=${deps.homeDir}, bin=${path.basename(dshBin)})`);
    })().finally(() => { this.startTask = null; });
    return this.startTask;
  }

  private async dropRuntime(): Promise<void> {
    const harness = this.harness;
    this.harness = null;
    if (harness) await harness.close().catch(() => {});
  }
}

const execFileAsync = promisify(execFile);

/** 归一化工作区路径：优先返回真实长路径（8.3 短名/符号链接会丢中文字符），失败则原样返回。 */
export function toLongRealPath(target: string): string {
  if (process.platform !== 'win32') return target;
  try { return fs.realpathSync.native(target); } catch { return target; }
}

function isPackaged(): boolean {
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  return Boolean(proc.resourcesPath) && __dirname.includes('app.asar');
}

/**
 * 解析 dsh 启动所需的 Node 与 CLI 入口。
 * 打包：resources/node/node.exe + resources/dsh-runtime（vendor 脚本产物）。
 * 开发：优先 resources/dsh-runtime（更接近打包形态），Node 用 PATH；
 *       vendor 目录不存在时回退主仓库 node_modules。
 */
export function resolveDshRuntimePaths(): { nodeCommand: string; dshBin: string } {
  if (isPackaged()) {
    const resources = (process as NodeJS.Process & { resourcesPath: string }).resourcesPath;
    return {
      nodeCommand: path.join(resources, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
      dshBin: path.join(resources, 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    };
  }
  const vendored = path.join(__dirname, '..', '..', 'resources', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (fs.existsSync(vendored)) return { nodeCommand: 'node', dshBin: vendored };
  return { nodeCommand: 'node', dshBin: require.resolve('@deepseek-ai/dsh/lib/bin.js') };
}

/**
 * dsh-tools 包目录（dsh 包的同级依赖）。
 * .agent-presets 预设目录没有 node_modules，插件加载 @deepseek-ai/dsh-tools 失败时
 * 用这个绝对路径回退解析（launch 注入 MUYUJIAN_DSH_TOOLS_PATH）。
 */
export function resolveDshToolsDir(dshBin: string): string {
  return path.join(path.dirname(dshBin), '..', '..', 'dsh-tools');
}

/**
 * 内置 Agent 禁用的 dsh 内置工具：文件/命令/联网/子代理一律不开放，
 * 模型只能通过 muyujian-dsh-tools 注册的业务能力读写数据。
 * （fs-sandbox/审批策略属于另一层；禁用即最稳妥的收口。）
 */
const DISABLED_BUILTIN_TOOLS = [
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'tool-web',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-workflow',
];

/** 插件源码默认位置：开发态 <repo>/plugins/muyujian-dsh-tools；打包后在 resources 下。 */
function defaultPluginDir(): string {
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  if (proc.resourcesPath && __dirname.includes('app.asar')) {
    // 打包后主进程在 app.asar 内，插件随 extraResources 放到 resources/plugins
    return path.join(proc.resourcesPath, 'plugins', 'muyujian-dsh-tools');
  }
  return path.join(__dirname, '..', '..', 'plugins', 'muyujian-dsh-tools');
}

/**
 * 准备 sdk profile（幂等）并返回追加的启动参数：
 * 1. 首启用 `--dump-config` 让 dsh 物化 profile（含 node_modules），无需凭据；
 * 2. 把 muyujian-dsh-tools 插件源码同步进 profile 的 node_modules（bare import 可解析）；
 * 3. 生成 `--patch` 覆盖层：挂载插件 + 禁用危险内置工具。
 */
export async function prepareSdkProfile(
  homeDir: string,
  opts: { nodeCommand: string; dshBin: string; pluginDir: string },
): Promise<string[]> {
  const profileDir = path.join(homeDir, 'profiles', 'sdk');
  const profileModules = path.join(profileDir, 'node_modules');

  if (!fs.existsSync(profileModules)) {
    await execFileAsync(opts.nodeCommand, [opts.dshBin, '--profile', 'sdk', '--dump-config'], {
      env: { ...process.env, DSH_HOME: homeDir, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
      maxBuffer: 32 * 1024 * 1024,
    });
  }

  fs.mkdirSync(profileModules, { recursive: true });
  const pluginTarget = path.join(profileModules, 'muyujian-dsh-tools');
  fs.mkdirSync(pluginTarget, { recursive: true });
  for (const file of ['package.json', 'index.js']) {
    fs.copyFileSync(path.join(opts.pluginDir, file), path.join(pluginTarget, file));
  }

  const patchFile = path.join(homeDir, 'muyujian.cordis.yml');
  const lines = [
    '# 由 DshRuntime 自动生成，请勿手改（启动时重写）',
    '- insert:',
    '    - id: muyujian-tools',
    "      name: 'muyujian-dsh-tools'",
    '',
    ...DISABLED_BUILTIN_TOOLS.flatMap((id) => [`- id: ${id}`, '  disabled: true', '']),
  ];
  fs.writeFileSync(patchFile, lines.join('\n'), 'utf-8');
  return ['--patch', patchFile];
}
