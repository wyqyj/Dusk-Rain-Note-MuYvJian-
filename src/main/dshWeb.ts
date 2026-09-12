import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { defaultPluginDirFor, resolveDshRuntimePaths, resolveDshToolsDir, syncBusinessPlugin, buildMountPatch } from './dshWebProfile';
import { buildPresetPatch, DshPresetId, syncNativeAgentPresets } from './dshPreset';
import { readHarnessModelConfig, seedHarnessModelConfig } from './dshConfig';
import { writeAgentToolManifest } from './agentToolManifest';

const execFileAsync = promisify(execFile);

export interface DshWebDeps {
  homeDir: string;
  workspaceRoot: () => string;
  /** 用户网关心配置（与 sdk 运行时同一 settings.yaml 入口） */
  getModelConfig?: () => { baseUrl: string; model: string } | null;
  getApiKey?: () => string;
  /** 业务工具桥（复用内部 Bridge） */
  getBridgeEndpoint?: () => Promise<{ url: string; token: string }>;
  log?: (line: string) => void;
  /** 测试注入：创建子进程 */
  spawnProcess?: (command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) => ChildProcess;
}

export interface DshWebStatus {
  running: boolean;
  url: string | null;
  error: string | null;
}

/**
 * 内置完整 dsh Web GUI：拉起 `dsh web --no-open --port 0` 子进程，
 * 从 stdout 截获带 token 的内网 URL，交给渲染端 <webview> 嵌入。
 * 与 sdk 运行时共用 DSH_HOME（settings.yaml / 业务插件 patch 一致）。
 */
export class DshWebGui {
  private currentPreset: DshPresetId = 'muyujian';
  private proc: ChildProcess | null = null;
  private url: string | null = null;
  private startTask: Promise<string> | null = null;
  private lastError: string | null = null;

  constructor(private deps: DshWebDeps) {}

  isRunning(): boolean { return Boolean(this.proc && !this.proc.killed); }
  status(): DshWebStatus { return { running: this.isRunning(), url: this.url, error: this.lastError }; }

  /** 返回可嵌入的完整 URL（含 token）；未运行则先启动。 */
  async ensureUrl(preset?: DshPresetId): Promise<string> {
    if (preset && preset !== this.currentPreset) {
      this.currentPreset = preset;
      if (this.proc) await this.stop();
    } else if (preset) {
      this.currentPreset = preset;
    }
    if (this.proc && this.url) return this.url;
    if (this.startTask) return this.startTask;
    this.startTask = this.launch().finally(() => { this.startTask = null; });
    return this.startTask;
  }

  async restart(preset?: DshPresetId): Promise<void> {
    if (preset) this.currentPreset = preset;
    await this.stop();
    await this.ensureUrl(this.currentPreset);
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    this.url = null;
    if (proc && !proc.killed) {
      proc.kill();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        proc.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
  }

  private async launch(): Promise<string> {
    const deps = this.deps;
    const resolved = resolveDshRuntimePaths();
    // 配置唯一事实源 = dsh home；旧版应用配置只做一次性播种，不重写用户在 GUI 里的修改
    const legacy = deps.getModelConfig?.();
    if (legacy) {
      try { seedHarnessModelConfig(deps.homeDir, { baseUrl: legacy.baseUrl, model: legacy.model, apiKey: deps.getApiKey?.() || null }); } catch { /* 播种失败不阻断启动 */ }
    }
    const pluginDir = defaultPluginDirFor();

    // web profile 物化 + 业务插件同步（只挂载，不禁用内置工具：用户要完整功能）
    const webModules = path.join(deps.homeDir, 'profiles', 'web', 'node_modules');
    if (!fs.existsSync(webModules)) {
      await execFileAsync(resolved.nodeCommand, [resolved.dshBin, 'web', '--dump-config'], {
        env: { ...process.env, DSH_HOME: deps.homeDir, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
        maxBuffer: 32 * 1024 * 1024,
      });
    }
    fs.mkdirSync(webModules, { recursive: true });
    syncBusinessPlugin(pluginDir, webModules);
    syncNativeAgentPresets(deps.homeDir, pluginDir);
    const patchFile = buildPresetPatch(deps.homeDir, this.currentPreset);

    const bridge = deps.getBridgeEndpoint ? await deps.getBridgeEndpoint() : null;
    // 业务工具清单必须先落盘，插件 apply 阶段会同步读取
    const manifestFile = writeAgentToolManifest(deps.homeDir, deps.workspaceRoot);
    const apiKey = readHarnessModelConfig(deps.homeDir)?.apiKey ?? deps.getApiKey?.() ?? '';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_HOME: deps.homeDir,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      MUYUJIAN_LLM_API_KEY: apiKey,
      MUYUJIAN_TOOL_MANIFEST: manifestFile,
      MUYUJIAN_DSH_TOOLS_PATH: resolveDshToolsDir(resolved.dshBin),
      ...(bridge ? { MUYUJIAN_BRIDGE_URL: bridge.url, MUYUJIAN_BRIDGE_TOKEN: bridge.token } : {}),
    };
    const cwd = deps.workspaceRoot();
    const create = deps.spawnProcess ?? ((c: string, a: string[], e: NodeJS.ProcessEnv, dir: string) =>
      spawn(c, a, { env: e, cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }));
    // --patch 是 launcher 旗标，必须在 app 旗标（--no-open 等）之前
    const proc = create(resolved.nodeCommand, [resolved.dshBin, 'web', '--patch', patchFile, '--no-open', '--port', '0'], env, cwd);
    this.proc = proc;
    proc.on('exit', () => { if (this.proc === proc) { this.proc = null; this.url = null; } });
    proc.stderr?.on('data', (chunk: Buffer) => deps.log?.(`[dsh-web] ${chunk.toString().trim()}`));

    const url = await new Promise<string>((resolvePromise, rejectPromise) => {
      let settled = false;
      const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
      const timer = setTimeout(() => finish(() => rejectPromise(new Error('dsh web 启动超时（30s）'))), 30000);
      proc.on('error', (err) => finish(() => rejectPromise(err)));
      proc.on('exit', (code) => finish(() => rejectPromise(new Error(`dsh web 提前退出（code=${code}）`))));
      let buf = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const match = buf.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);
        if (match) finish(() => resolvePromise(match[0]));
      });
    });
    this.lastError = null;
    this.url = url;
    return url;
  }
}
