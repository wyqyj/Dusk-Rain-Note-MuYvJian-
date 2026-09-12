import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, safeStorage, screen, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import Store from 'electron-store';
import { WorkspaceStorage } from './workspaceStorage';
import { enqueueFile, mergeNotes, readJsonValue, sanitizeNoteUpdates, writeAtomic } from './notesData';
import { AgentBridge, BridgeOptions, generateBridgeToken } from './agentBridge';
import { DshRuntime } from './dshRuntime';
import { DshWebGui } from './dshWeb';
import { startDshConfigWatcher } from './dshConfigWatcher';
import { readHarnessModelConfig, seedHarnessModelConfig, upsertHarnessModelConfig } from './dshConfig';
import { KnowledgeService } from './knowledgeService';

const pandocPath = app.isPackaged
  ? path.join(process.resourcesPath, 'pandoc', 'pandoc.exe')
  : path.join(__dirname, '..', '..', 'resources', 'pandoc', 'pandoc.exe');
const updateNoticesPath = app.isPackaged
  ? path.join(process.resourcesPath, 'UPDATE_NOTICES.md')
  : path.join(__dirname, '..', '..', 'UPDATE_NOTICES.md');

let dataDir = app.isPackaged
  ? path.join(app.getPath('userData'), 'data')
  : path.join(__dirname, '..', 'data');
try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}

// 内置 Agent 运行时：DeepSeek Harness 子进程（DSH_HOME 独立存放在 userData，不随工作区迁移）
const dshHomeDir = path.join(app.getPath('userData'), 'dsh-home');
try { fs.mkdirSync(dshHomeDir, { recursive: true }); } catch {}

interface AppStore {
  quickNote: string;
  settings: { theme: 'light' | 'dark'; textMode: string; quickNoteShortcut: string; autoSaveInterval: number; dataPath: string; };
  windowBounds?: { x: number; y: number; width: number; height: number };
  quickNoteBounds?: { x: number; y: number; width: number; height: number };
  todayPlanBounds?: { x: number; y: number; width: number; height: number };
  todayPlanOpacity?: number;
  initialized?: boolean;
  aiConfig?: { baseUrl: string; model: string };
  encryptedAiApiKey?: string;
  legacyAiMigrated?: boolean;
  agentBridge?: { enabled: boolean; bind: 'loopback' | 'lan'; token: string };
}

const store = new Store<AppStore>({
  cwd: dataDir,
  defaults: {
    quickNote: '',
    settings: { theme: 'light', textMode: 'modern', quickNoteShortcut: 'Alt+Q', autoSaveInterval: 60, dataPath: dataDir },
    todayPlanOpacity: 1,
    initialized: false,
  },
});

type AiAction = 'summarize' | 'outline' | 'review-cards' | 'rewrite' | 'chat';
type AiPublicConfig = { baseUrl: string; model: string; configured: boolean; secureStorageAvailable: boolean };

const aiRequests = new Map<string, AbortController>();
const defaultAiConfig = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' };

function getLegacyAiConfig(): { baseUrl: string; model: string } {
  const saved = store.get('aiConfig');
  return { ...defaultAiConfig, ...saved };
}

/** AI 助手展示用的当前配置：优先 dsh home（Agent 页 GUI 里改的同一份），旧版 store 兜底 */
function getAiConfig(): AiPublicConfig {
  const harness = readHarnessModelConfig(dshHomeDir);
  if (harness) {
    // Key 也可能还在旧版安全存储里（迁移未完成时），不要把状态徽标误报为「未配置」
    const hasKey = Boolean(harness.apiKey) || Boolean(store.get('encryptedAiApiKey'));
    return { baseUrl: harness.baseUrl, model: harness.model, configured: hasKey, secureStorageAvailable: true };
  }
  const legacy = getLegacyAiConfig();
  return { ...legacy, configured: Boolean(store.get('encryptedAiApiKey')), secureStorageAvailable: safeStorage.isEncryptionAvailable() };
}

/** AI 助手问答直连用的完整连接信息（含 Key），dsh home 优先、旧版 safeStorage 兜底 */
function resolveAiConnection(): { baseUrl: string; model: string; apiKey: string } {
  const harness = readHarnessModelConfig(dshHomeDir);
  if (harness?.apiKey) {
    return { baseUrl: validateAiBaseUrl(harness.baseUrl), model: harness.model, apiKey: harness.apiKey };
  }
  const legacy = getLegacyAiConfig();
  return { baseUrl: validateAiBaseUrl(legacy.baseUrl), model: legacy.model, apiKey: decryptAiApiKey() };
}

// 一次性迁移：旧版（electron-store + safeStorage）AI 配置播种到 dsh home，之后由 Agent 页 GUI 统一管理
void (() => {
  try {
    if (store.get('legacyAiMigrated')) return;
    const saved = store.get('aiConfig');
    if (saved?.baseUrl && saved.model) {
      let apiKey: string | null = null;
      try { apiKey = decryptAiApiKey(); } catch { /* 没有旧 key */ }
      seedHarnessModelConfig(dshHomeDir, { baseUrl: validateAiBaseUrl(saved.baseUrl), model: saved.model, apiKey });
    }
    store.set('legacyAiMigrated', true);
  } catch { /* 迁移失败不影响启动，Agent 启动时还会再播种 */ }
})();

function decryptAiApiKey(): string {
  const encrypted = store.get('encryptedAiApiKey');
  if (!encrypted) throw new Error('请先在 AI 设置中保存 API Key');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统安全存储不可用，无法读取 API Key');
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

function validateAiBaseUrl(value: string): string {
  const url = new URL(value);
  const isLocal = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocal) throw new Error('AI Base URL 必须使用 HTTPS；仅本地模型允许 HTTP');
  // OpenAI 兼容网关的端点都在 /v1 下；用户只填到根域名时自动补全，避免落到网关网站首页（导致 200 HTML 假响应）
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/v1';
  return url.toString().replace(/\/$/, '');
}

function aiInstructions(action: AiAction): string {
  const common = '你是暮雨笺中的学习与写作助手。仅依据用户提供的文本作答；使用简体中文和 Markdown；不要捏造资料、引用或事实。';
  const actions: Record<AiAction, string> = {
    summarize: '提炼结构化摘要，包含核心观点、关键细节和待确认项。',
    outline: '整理为层级清晰的 Markdown 提纲，保留原意，不添加无依据内容。',
    'review-cards': '生成可复习的问答卡片。每张使用“## 问题”和“答案”两行，覆盖关键概念而不重复。',
    rewrite: '在不改变事实和立场的前提下润色文字，使表达清晰、简练、适合笔记阅读。',
    chat: '自由对话：直接、准确地回答用户问题；涉及数学公式时使用 $…$ 或 $$…$$ 记号；篇幅适中，不堆砌客套话。',
  };
  return `${common}\n\n任务：${actions[action]}`;
}

function parseSseEvents(buffer: string, onDelta: (delta: string) => void): string {
  const events = buffer.split(/\r?\n\r?\n/);
  const remaining = events.pop() || '';
  for (const event of events) {
    const payload = event.match(/^data:\s*(.+)$/m)?.[1]?.trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload);
      // chat.completion.chunk：choices[0].delta.content；兼容少数网关透传的 delta 字段
      if (typeof parsed.delta === 'string') { onDelta(parsed.delta); continue; }
      const choice = parsed.choices?.[0];
      const text = choice?.delta?.content ?? choice?.message?.content;
      if (typeof text === 'string' && text) onDelta(text);
    } catch { /* Ignore incomplete or provider-specific events. */ }
  }
  return remaining;
}

/**
 * 主进程内统一的外发请求通道。
 * 全局 fetch（undici）不走系统代理，在靠 Clash/VPN 出口的网络上会直连超时；
 * Electron 的 net.fetch（Chromium 内核）自动遵循系统代理设置，优先使用它。
 */
async function aiFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
): Promise<Response> {
  if (typeof net?.fetch === 'function') {
    return net.fetch(url, init) as unknown as Promise<Response>;
  }
  return fetch(url, init);
}


function buildSystemPromptWithKnowledge(action: AiAction, query: string, options?: { sourceIds?: string[]; bundleIds?: string[] }): string {
  let system = aiInstructions(action);
  if (knowledgeService && action === 'chat') {
    try {
      const hits = knowledgeService.search(query, { sourceIds: options?.sourceIds, bundleIds: options?.bundleIds, limit: 5 });
      if (hits.length > 0) {
        const contextText = hits
          .map((h, i) => `[${i + 1}] 来源《${h.source.title}》:\n${h.text}`)
          .join('\n\n');
        system += `\n\n### 参考知识库资料\n请结合以下参考资料作答（若与常识冲突以资料为准，必要时在回答中指出来源）：\n${contextText}`;
      }
    } catch (err) {
      console.error('[knowledge] search error:', err);
    }
  }
  return system;
}

async function requestAi(sender: Electron.WebContents, requestId: string, action: AiAction, content: string, knowledgeOptions?: { sourceIds?: string[]; bundleIds?: string[] }): Promise<void> {
  const controller = new AbortController();
  aiRequests.set(requestId, controller);
  // 窗口可能在生成过程中被关闭，向已销毁的 webContents 发送会抛异常
  const send = (payload: Record<string, unknown>): boolean => {
    if (sender.isDestroyed()) { console.warn('[ai] sender destroyed, drop event', payload); return false; }
    sender.send('ai-stream', { requestId, ...payload });
    return true;
  };
  try {
    // 与 Agent 共用同一条网关路由（dsh home 优先）；网关实测支持 /chat/completions
    const connection = resolveAiConnection();
    const response = await aiFetch(`${connection.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        model: connection.model,
        messages: [
          { role: 'system', content: buildSystemPromptWithKnowledge(action, content, knowledgeOptions) },
          { role: 'user', content },
        ],
        stream: true,
        max_tokens: 2400,
      }),
    });
    if (!response.ok || !response.body) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`AI 请求失败（${response.status}）：${detail || response.statusText}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      if (sender.isDestroyed()) { controller.abort(); break; }
      const next = await reader.read();
      if (next.done) break;
      pending = parseSseEvents(pending + decoder.decode(next.value, { stream: true }), (delta) => { send({ delta }); });
    }
    parseSseEvents(pending + decoder.decode(), (delta) => { send({ delta }); });
    send({ done: true });
  } catch (error: any) {
    // undici 的 "fetch failed" 不带细节，真实原因（TLS/代理/DNS）在 cause 里
    const cause = (error as any)?.cause;
    const detail = cause ? `${cause.code || cause.name || ''} ${cause.message || ''}`.trim() : '';
    send({ done: true, error: error?.name === 'AbortError' ? '已取消生成。' : (`${error?.message || 'AI 请求失败'}${detail ? `（${detail}）` : ''}`) });
  } finally {
    aiRequests.delete(requestId);
  }
}

function readUpdateNotices(): string {
  try { return fs.readFileSync(updateNoticesPath, 'utf-8'); }
  catch { return '# 暮雨笺更新告示\n\n未能读取内置更新记录，请在项目根目录查看 UPDATE_NOTICES.md。'; }
}

function createInitialNotes(): boolean {
  try {
    // 预置笔记属于可迁移的工作台数据，不能写入 electron-store 所在的旧数据目录。
    const notesPath = path.join(workspaceStorage.getRoot(), 'notes.json');
    let notes: any[] = [];
    try { if (fs.existsSync(notesPath)) notes = JSON.parse(fs.readFileSync(notesPath, 'utf-8')); } catch {}
    if (notes.length > 0) {
      store.set('initialized', true);
      return true;
    }
    const now = Date.now();
    const initialNotes = [
      {
        id: 'welcome-001', title: '暮雨笺 · 功能介绍',
        content: `暮雨笺是一款融合记事本、待办管理与快速随笔记的桌面应用，支持 Markdown 和 LaTeX 数学公式的实时渲染。

便签管理
- 点击侧边栏「新建便签」按钮创建新便签
- 顶部搜索框支持按标题和内容模糊搜索，结果高亮显示
- 为便签添加标签，支持多选标签筛选（AND 逻辑）
- 标签输入时可从已有标签下拉选择，也可手动输入新标签
- 便签支持全局置顶和标签内独立置顶
- 便签可归档、删除（进入回收站）、设置截止日期
- 回收站中的便签可恢复或永久删除

编辑器
- 基于 CodeMirror 6 的 Markdown 编辑器，支持语法高亮和自动换行
- Ctrl+F 搜索、Ctrl+H 替换
- 快捷键：Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+K 链接
- 支持插入图片（工具栏选择、粘贴、拖拽均可）
- 支持代码块，自动识别 16 种编程语言语法高亮
- 支持笔记链接：用 [[标题]] 语法链接到其他便签，点击即可跳转

待办系统
- 点击 ☆ 将便签标记为待办，或直接新建待办便签
- 待办便签支持批量添加任务（每行一个）
- 每个任务可单独设置截止时间，显示天:时:分 倒计时
- 每个任务支持正向计时（秒表），记录用时数据
- 侧边栏「任务统计」查看今日/本周/本月用时饼状图和时间线
- 侧边栏「待办」分类中，未完成的待办便签自动置顶
- 全部任务完成后便签自动变灰
- 支持悬浮窗口查看，窗口始终置顶，可调节透明度

快速笔记
- 按 Alt+Q 呼出悬浮速记小窗口
- 关闭时内容自动保存为便签（标签：随笔记）
- 支持编辑、预览、分栏三种模式

界面
- 浅色与深色主题切换（顶栏月亮图标）
- 简体中文与古风文字切换（顶栏按钮）
- 预览面板可显示或隐藏（Ctrl+Shift+P）
- F11 进入专注模式，隐藏侧边栏和预览，沉浸写作

导出
- 预览面板中可将便签导出为 Word、PDF、Markdown、HTML、纯文本
- 导出 PDF 需系统安装 LaTeX 发行版（如 MiKTeX）

排序
- 支持按更新时间、创建时间、标题、截止日期排序
- 点击升降序按钮切换排列方向

提示：所有数据存储在安装目录的 data 文件夹中，可随时备份。`,
        tags: ['启程'], createdAt: now, updatedAt: now, isTodayPlan: false, noteType: 'note', isArchived: false,
      },
      {
        id: 'welcome-002', title: 'Markdown 语法演示',
        content: `暮雨笺支持完整的 Markdown 语法，编辑时右侧预览面板会实时渲染。

这是一段**加粗文字**，这是*斜体文字*，这是\`行内代码\`。

> 这是一段引用文字，适合用来标注重点或摘录。

- 无序列表项一
- 无序列表项二
- 无序列表项三

1. 有序列表项一
2. 有序列表项二
3. 有序列表项三

- [x] 已完成的任务
- [ ] 待完成的任务

\`\`\`javascript
// 代码块支持语法高亮
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

---

| 功能     | 说明               |
| -------- | ------------------ |
| 加粗     | 用 \`**\` 包裹文字   |
| 斜体     | 用 \`*\` 包裹文字    |
| 代码     | 用反引号包裹       |
| 链接     | \`[文字](地址)\`     |
| 任务     | \`- [ ]\` 或 \`- [x]\` |
| 笔记链接 | \`[[标题]]\` 双链跳转 |

---

笔记链接演示：这是一条指向 [[暮雨笺 · 功能介绍]] 的链接，点击可跳转。

> 提示：编辑此便签，观察右侧预览面板的实时渲染效果。`,
        tags: ['启程'], createdAt: now + 1, updatedAt: now + 1, isTodayPlan: false, noteType: 'note', isArchived: false,
      },
      {
        id: 'welcome-003', title: 'LaTeX 公式演示',
        content: `暮雨笺支持 LaTeX 数学公式的实时渲染。行内公式用单个 $ 包裹，块级公式用双 $$ 包裹。

行内公式示例：质能方程 $E = mc^2$，欧拉公式 $e^{i\\pi} + 1 = 0$。

二次方程求根公式：

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

高斯积分：

$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

矩阵表示：

$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\begin{pmatrix} x \\\\ y \\end{pmatrix} = \\begin{pmatrix} ax + by \\\\ cx + dy \\end{pmatrix}$$

泰勒展开：

$$e^x = \\sum_{n=0}^{\\infty} \\frac{x^n}{n!} = 1 + x + \\frac{x^2}{2!} + \\frac{x^3}{3!} + \\cdots$$

也支持 equation 环境：

\\begin{equation}
\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}
\\end{equation}

> 提示：编辑此便签，观察右侧预览面板的实时渲染效果。`,
        tags: ['启程'], createdAt: now + 2, updatedAt: now + 2, isTodayPlan: false, noteType: 'note', isArchived: false,
      },
      {
        id: 'welcome-004', title: '暮雨笺 · 版本更新记录',
        content: readUpdateNotices(),
        tags: ['更新记录'], createdAt: now + 3, updatedAt: now + 3, isTodayPlan: false, noteType: 'note', isArchived: false,
      },
    ];
    notes.unshift(...initialNotes);
    fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    store.set('initialized', true);
    return true;
  } catch (err) {
    console.error('创建预置笔记失败:', err);
    return false;
  }
}

let mainWindow: BrowserWindow | null = null;
let workspaceStorage: WorkspaceStorage;
let agentBridge: AgentBridge | null = null;
let knowledgeService: KnowledgeService | null = null;
function getNormalizedAiModelConfig(): { baseUrl: string; model: string } | null {
  const { baseUrl, model } = getAiConfig();
  try { return { baseUrl: validateAiBaseUrl(baseUrl), model }; } catch { return null; }
}
const dshRuntime = new DshRuntime({
  workspaceRoot: () => workspaceStorage.getRoot(),
  getApiKey: decryptAiApiKey,
  getModelConfig: () => getNormalizedAiModelConfig(),
  homeDir: dshHomeDir,
  getBridgeEndpoint: ensureInternalAgentBridge,
});
// 完整 dsh Web GUI 运行时（Agent 页嵌入用），与 sdk 运行时共用 DSH_HOME / 内部 Bridge
const dshWebGui = new DshWebGui({
  homeDir: dshHomeDir,
  workspaceRoot: () => workspaceStorage.getRoot(),
  getModelConfig: () => getNormalizedAiModelConfig(),
  getApiKey: decryptAiApiKey,
  getBridgeEndpoint: ensureInternalAgentBridge,
  log: (line) => console.warn(line),
});
// 配置热重载：在 dsh Web GUI 里改模型/Key 时自动重启运行时（web 子进程仅运行中才重启）
const stopDshConfigWatcher = startDshConfigWatcher({
  homeDir: dshHomeDir,
  onChange: () => {
    void dshRuntime.restart();
    if (dshWebGui.isRunning()) void dshWebGui.restart();
  },
});
// 内置 Agent 专用 Bridge：独立于用户配置的"对外接入"桥，
// 只绑 loopback、token 每次启动随机生成且不落盘，仅 dsh 子进程回调用。
let internalAgentBridge: AgentBridge | null = null;
let internalAgentBridgeToken = '';
// 内置 Agent 写操作确认：挂在内存里的待决请求，渲染端回执或 120s 超时拒绝
let agentConfirmSeq = 0;
const pendingAgentConfirms = new Map<string, (approved: boolean) => void>();
const AGENT_CONFIRM_TIMEOUT_MS = 120_000;

function requestAgentConfirm(req: { capability: string; description: string; params: Record<string, unknown> }): Promise<boolean> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return Promise.resolve(false);
  const id = `agent-confirm-${Date.now()}-${++agentConfirmSeq}`;
  return new Promise((resolve) => {
    pendingAgentConfirms.set(id, resolve);
    win.webContents.send('dsh-agent-confirm-request', { id, ...req });
    setTimeout(() => {
      if (pendingAgentConfirms.delete(id)) resolve(false);
    }, AGENT_CONFIRM_TIMEOUT_MS);
  });
}

async function ensureInternalAgentBridge(): Promise<{ url: string; token: string }> {
  if (!internalAgentBridge || !internalAgentBridge.status().running) {
    internalAgentBridgeToken = generateBridgeToken();
    internalAgentBridge = new AgentBridge(
      { enabled: true, bind: 'loopback', token: internalAgentBridgeToken, portPreferred: 22921 },
      { workspaceRoot: () => workspaceStorage.getRoot(), confirmWrite: requestAgentConfirm },
    );
    await internalAgentBridge.start();
  }
  const status = internalAgentBridge.status();
  return { url: `http://127.0.0.1:${status.port}`, token: internalAgentBridgeToken };
}
const quickNoteWindows: BrowserWindow[] = [];
const MAX_QUICK_NOTE_WINDOWS = 10;
let todayPlanWindow: BrowserWindow | null = null;
let timerStatsWindow: BrowserWindow | null = null;
let lastQuickNoteCreateTime = 0;
let contentSecurityPolicyInstalled = false;

function clampOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(0.2, Math.min(1, value));
}

/** 依次尝试常见中文字体，全部缺失时返回最后一次错误。 */
const PDF_CJK_FONT_CANDIDATES = ['Microsoft YaHei', 'Noto Sans CJK SC', 'SimSun', 'PingFang SC'];

function runPandoc(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(pandocPath, args, (err) => (err ? reject(err) : resolve()));
  });
}

function isPathWithin(targetPath: string, roots: string[]): boolean {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) return false;
    const target = fs.realpathSync(path.resolve(targetPath));
    return roots.some((root) => {
      if (!fs.existsSync(root)) return false;
      const resolvedRoot = fs.realpathSync(path.resolve(root));
      const relative = path.relative(resolvedRoot, target);
      return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    });
  } catch {
    return false;
  }
}

function writePayload(filePath: string, payload: string, expected: 'array' | 'object'): { success: boolean; error?: string } {
  try {
    if (typeof payload !== 'string' || payload.length > 100 * 1024 * 1024) throw new Error('数据内容无效或超过 100MB 限制');
    const parsed: unknown = JSON.parse(payload);
    if (expected === 'array' ? !Array.isArray(parsed) : (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('数据格式无效');
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporary, payload, 'utf-8');
    fs.renameSync(temporary, filePath);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function getTrustedOpenRoots(): string[] {
  const examplesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'examples', 'workbench')
    : path.join(__dirname, '..', '..', 'examples', 'workbench');
  const skillsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'skills', 'muyujian-question-book-import')
    : path.join(__dirname, '..', '..', 'skills', 'muyujian-question-book-import');
  const planSkillPath = app.isPackaged
    ? path.join(process.resourcesPath, 'skills', 'muyujian-plan-import')
    : path.join(__dirname, '..', '..', 'skills', 'muyujian-plan-import');
  return [workspaceStorage?.getRoot(), examplesPath, skillsPath, planSkillPath].filter((root): root is string => typeof root === 'string' && root.length > 0);
}

function installContentSecurityPolicy(win: BrowserWindow): void {
  if (contentSecurityPolicyInstalled) return;
  contentSecurityPolicyInstalled = true;
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    // dsh Web GUI 等回环服务托管自己的应用与 CSP（其前端依赖 eval），不要再覆盖
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(details.url) && !details.url.startsWith('http://localhost:5173')) {
      callback({});
      return;
    }
    const headers = { ...details.responseHeaders };
    // 开发模式下 vite 需要 dev server 来源 + react-refresh 的内联引导脚本
    const devSrc = app.isPackaged ? '' : ' http://localhost:5173 ws://localhost:5173';
    const scriptSrc = app.isPackaged ? "script-src 'self'" : "script-src 'self' 'unsafe-inline'";
    headers['Content-Security-Policy'] = [
      // dsh web GUI 通过 <webview> 内嵌，回环地址动态端口，需放行 frame-src
      `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: file: blob:; font-src 'self' data:; connect-src 'self'${devSrc}; object-src 'none'; frame-src http://127.0.0.1:* http://localhost:*; base-uri 'self'; form-action 'none'`,
    ];
    callback({ responseHeaders: headers });
  });
}

/** 把内容中的 attachment: 令牌替换为 attachments/ 目录下的绝对路径，供 pandoc 使用。 */
function resolveAttachmentTokens(content: string): string {
  if (!content.includes('attachment:')) return content;
  return content.replace(/attachment:([^\s()"'\]]+)/g, (_m, name: string) =>
    path.join(workspaceStorage.getRoot(), 'attachments', path.basename(name))
  );
}

/** 优先加载构建产物；打包后发现渲染产物缺失时直接报错，不回退到本机开发地址。 */
function loadRenderer(win: BrowserWindow, hash?: string): void {
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  if (fs.existsSync(rendererPath)) {
    void win.loadFile(rendererPath, hash ? { hash } : undefined);
  } else if (!app.isPackaged) {
    void win.loadURL(`http://localhost:5173${hash ? `#${hash}` : ''}`);
  } else {
    dialog.showErrorBox('暮雨笺启动失败', '未找到应用界面资源，请重新安装后重试。');
  }
}

function resolveMainWindowBounds(savedBounds?: AppStore['windowBounds']): Electron.Rectangle {
  const primaryArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(Math.max(savedBounds?.width || 1200, 900), primaryArea.width);
  const height = Math.min(Math.max(savedBounds?.height || 800, 600), primaryArea.height);
  const x = savedBounds?.x;
  const y = savedBounds?.y;
  const hasSavedPosition = typeof x === 'number' && typeof y === 'number';
  const isVisible = hasSavedPosition && screen.getAllDisplays().some(({ workArea }) =>
    x! < workArea.x + workArea.width && x! + width > workArea.x &&
    y! < workArea.y + workArea.height && y! + height > workArea.y
  );

  if (isVisible) return { x: x!, y: y!, width, height };
  return {
    x: primaryArea.x + Math.round((primaryArea.width - width) / 2),
    y: primaryArea.y + Math.round((primaryArea.height - height) / 2),
    width,
    height,
  };
}

function createMainWindow(): void {
  const bounds = resolveMainWindowBounds(store.get('windowBounds'));
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900, minHeight: 600, title: '暮雨笺',
    frame: false,
    backgroundColor: store.get('settings.theme') === 'dark' ? '#030712' : '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true },
    show: false,
  });
  installContentSecurityPolicy(mainWindow);
  loadRenderer(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', () => { if (mainWindow) store.set('windowBounds', mainWindow.getBounds()); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createQuickNoteWindow(): void {
  const now = Date.now();
  if (now - lastQuickNoteCreateTime < 500) return;
  lastQuickNoteCreateTime = now;
  for (let i = quickNoteWindows.length - 1; i >= 0; i--) {
    if (quickNoteWindows[i].isDestroyed()) quickNoteWindows.splice(i, 1);
  }
  if (quickNoteWindows.length >= MAX_QUICK_NOTE_WINDOWS) {
    quickNoteWindows[quickNoteWindows.length - 1].show();
    quickNoteWindows[quickNoteWindows.length - 1].focus();
    return;
  }
  const savedBounds = store.get('quickNoteBounds') as any;
  const win = new BrowserWindow({
    width: savedBounds?.width || 450, height: savedBounds?.height || 500,
    frame: false, alwaysOnTop: true, resizable: true, movable: true, skipTaskbar: true,
    title: '暮雨笺 · 速记',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  loadRenderer(win, '/quick-note');
  win.once('ready-to-show', () => win.show());
  let closingFromRenderer = false;
  win.on('close', (e) => {
    if (!win.isDestroyed()) store.set('quickNoteBounds', win.getBounds());
    // 如果不是渲染器主动关闭的（如 Alt+F4），先通知保存再关闭
    if (!closingFromRenderer) {
      e.preventDefault();
      win.webContents.send('save-before-close');
      setTimeout(() => { if (!win.isDestroyed()) { closingFromRenderer = true; win.close(); } }, 200);
    }
  });
  win.on('closed', () => {
    const idx = quickNoteWindows.indexOf(win);
    if (idx !== -1) quickNoteWindows.splice(idx, 1);
  });
  // 记录渲染器主动关闭的标记
  (win as any).__closingFromRenderer = () => { closingFromRenderer = true; };
  quickNoteWindows.push(win);
}

function createTodayPlanWindow(): void {
  if (todayPlanWindow) { todayPlanWindow.show(); todayPlanWindow.focus(); return; }
  const savedBounds = store.get('todayPlanBounds') as any;
  const savedOpacity = clampOpacity(store.get('todayPlanOpacity'));
  todayPlanWindow = new BrowserWindow({
    width: savedBounds?.width || 420, height: savedBounds?.height || 600,
    x: savedBounds?.x, y: savedBounds?.y,
    frame: false, alwaysOnTop: true, resizable: true, movable: true,
    title: '暮雨笺 · 待办',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  todayPlanWindow.setOpacity(savedOpacity);
  loadRenderer(todayPlanWindow, '/today-plan');
  todayPlanWindow.once('ready-to-show', () => todayPlanWindow?.show());
  todayPlanWindow.on('close', () => { if (todayPlanWindow) store.set('todayPlanBounds', todayPlanWindow.getBounds()); });
  todayPlanWindow.on('closed', () => { todayPlanWindow = null; });
}

function createTimerStatsWindow(): void {
  if (timerStatsWindow) { timerStatsWindow.show(); timerStatsWindow.focus(); return; }
  timerStatsWindow = new BrowserWindow({
    width: 700, height: 550,
    frame: false, resizable: true, movable: true,
    title: '暮雨笺 · 任务统计',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  loadRenderer(timerStatsWindow, '/timer-stats');
  timerStatsWindow.once('ready-to-show', () => timerStatsWindow?.show());
  timerStatsWindow.on('closed', () => { timerStatsWindow = null; });
}

function setupIPC(): void {
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('ai-get-config', () => getAiConfig());
  ipcMain.handle('ai-save-config', (_e: any, value: unknown) => {
    try {
      if (!value || typeof value !== 'object') throw new Error('AI 配置无效');
      const input = value as { baseUrl?: unknown; model?: unknown; apiKey?: unknown; clearApiKey?: unknown };
      const current = getAiConfig();
      const baseUrl = validateAiBaseUrl(typeof input.baseUrl === 'string' ? input.baseUrl.trim() : current.baseUrl);
      const model = typeof input.model === 'string' ? input.model.trim() : current.model;
      if (!model || model.length > 120) throw new Error('模型名称无效');
      if (input.clearApiKey === true) store.delete('encryptedAiApiKey');
      if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统安全存储不可用，无法保存 API Key');
        store.set('encryptedAiApiKey', safeStorage.encryptString(input.apiKey.trim()).toString('base64'));
      }
      store.set('aiConfig', { baseUrl, model });
      // 同步到 dsh home，保证 AI 助手与 Agent 页用的是同一份网关配置
      upsertHarnessModelConfig(dshHomeDir, {
        baseUrl, model,
        apiKey: typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : null,
        clearApiKey: input.clearApiKey === true,
      });
      // 网关/模型/Key 变化：重建 dsh 运行时，下次调用用新配置
      void dshRuntime.restart();
      void dshWebGui.restart();
      return { success: true, config: getAiConfig() };
    } catch (error: any) { return { success: false, error: error?.message || '保存 AI 配置失败' }; }
  });
  ipcMain.handle('ai-test-connection', async () => {
    try {
      const connection = resolveAiConnection();
      const response = await aiFetch(`${connection.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: connection.model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16 }),
      });
      if (!response.ok) throw new Error((await response.text()).slice(0, 500) || `HTTP ${response.status}`);
      return { success: true };
    } catch (error: any) { return { success: false, error: error?.message || '连接测试失败' }; }
  });
  
    // ---- 知识库能力 IPC ----
    ipcMain.handle('knowledge-get-sources', () => {
      if (!knowledgeService) return [];
      return knowledgeService.listAvailableSources();
    });
    ipcMain.handle('knowledge-search', (_e: any, query: string, options?: { sourceIds?: string[]; bundleIds?: string[]; limit?: number }) => {
      if (!knowledgeService) return [];
      return knowledgeService.search(query, options);
    });
    ipcMain.handle('knowledge-bundles-list', () => {
      if (!knowledgeService) return [];
      return knowledgeService.listBundles();
    });
    ipcMain.handle('knowledge-bundles-save', (_e: any, bundle: any) => {
      if (!knowledgeService) return null;
      return knowledgeService.saveBundle(bundle);
    });
    ipcMain.handle('knowledge-bundles-delete', (_e: any, id: string) => {
      if (!knowledgeService) return false;
      return knowledgeService.deleteBundle(id);
    });

    
ipcMain.handle('ai-start', (event: Electron.IpcMainInvokeEvent, value: unknown) => {
    try {
      if (!value || typeof value !== 'object') throw new Error('AI 请求无效');
      const input = value as { action?: unknown; content?: unknown; knowledgeSourceIds?: unknown; knowledgeBundleIds?: unknown };
      const action = input.action;
      const content = input.content;
      const knowledgeSourceIds = Array.isArray(input.knowledgeSourceIds) ? input.knowledgeSourceIds.map(String) : undefined;
      const knowledgeBundleIds = Array.isArray(input.knowledgeBundleIds) ? input.knowledgeBundleIds.map(String) : undefined;
      const allowed: AiAction[] = ['summarize', 'outline', 'review-cards', 'rewrite', 'chat'];
      if (!allowed.includes(String(action) as AiAction)) throw new Error('不支持的 AI 操作');
      if (typeof content !== 'string' || !content.trim()) throw new Error('没有可发送的内容');
      if (content.length > 100_000) throw new Error('单次最多发送 100,000 个字符，请先拆分内容');
      const requestId = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      void requestAi(event.sender, requestId, action as AiAction, content, { sourceIds: knowledgeSourceIds, bundleIds: knowledgeBundleIds });
      return { success: true, requestId };
    } catch (error: any) { return { success: false, error: error?.message || '启动 AI 请求失败' }; }
  });
  ipcMain.handle('ai-cancel', (_e: any, requestId: unknown) => {
    if (typeof requestId !== 'string') return false;
    const controller = aiRequests.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  });
  // ---- 内置 Agent（DeepSeek Harness 子进程） ----
  ipcMain.handle('dsh-agent-run', async (event: Electron.IpcMainInvokeEvent, value: unknown) => {
    try {
      const input = (value && typeof value === 'object' ? value : {}) as { text?: unknown; sessionId?: unknown };
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) throw new Error('没有可发送的内容');
      const sessionId = typeof input.sessionId === 'string' && input.sessionId ? input.sessionId : undefined;
      const sender = event.sender;
      const result = await dshRuntime.run(sessionId, text, (notification) => {
        if (!sender.isDestroyed()) sender.send('dsh-agent-event', notification);
      });
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Agent 运行失败' };
    }
  });
  ipcMain.handle('dsh-agent-stop', async () => {
    // SDK 协议无轮次中取消：重启运行时，会话历史保留在 DSH_HOME
    await dshRuntime.restart();
    return { success: true };
  });
  ipcMain.handle('dsh-agent-status', () => ({ running: dshRuntime.isRunning() }));
  ipcMain.handle('dsh-web-start', async () => {
    try {
      const url = await dshWebGui.ensureUrl();
      return { success: true, url };
    } catch (error: any) {
      return { success: false, error: error?.message || 'dsh web 启动失败' };
    }
  });
  ipcMain.handle('dsh-web-stop', async () => { await dshWebGui.stop(); return { success: true }; });
  ipcMain.handle('dsh-web-status', () => dshWebGui.status());
  ipcMain.handle('dsh-agent-confirm-resolve', (_e: any, value: unknown) => {
    const input = (value && typeof value === 'object' ? value : {}) as { id?: unknown; approved?: unknown };
    if (typeof input.id !== 'string') return false;
    const resolve = pendingAgentConfirms.get(input.id);
    if (!resolve) return false;
    pendingAgentConfirms.delete(input.id);
    resolve(input.approved === true);
    return true;
  });
  ipcMain.handle('workspace-get-state', () => workspaceStorage.readState());
  ipcMain.handle('workspace-save-state', (_e: any, state: string) => workspaceStorage.writeState(state));
  ipcMain.handle('workspace-reset', () => {
    const result = workspaceStorage.reset();
    if (!result.success) return result;
    store.store = {
      quickNote: '',
      settings: { theme: 'light', textMode: 'modern', quickNoteShortcut: 'Alt+Q', autoSaveInterval: 60, dataPath: workspaceStorage.getRoot() },
      todayPlanOpacity: 1,
      initialized: false,
    };
    if (!createInitialNotes()) {
      return { ...result, success: false, error: '工作台已清空，但预置笔记创建失败。请检查当前数据目录的写入权限后重试初始化。' };
    }
    for (const win of quickNoteWindows.splice(0)) {
      if (!win.isDestroyed()) win.destroy();
    }
    if (todayPlanWindow && !todayPlanWindow.isDestroyed()) todayPlanWindow.destroy();
    if (timerStatsWindow && !timerStatsWindow.isDestroyed()) timerStatsWindow.destroy();
    notifyAllReload();
    return { ...result, initialized: true };
  });
  ipcMain.handle('workspace-get-root', () => workspaceStorage.getRoot());
  ipcMain.handle('workspace-choose-root', () => workspaceStorage.chooseRoot(BrowserWindow.getFocusedWindow()));
  ipcMain.handle('workspace-migrate', (_e: any, destination: string) => {
    const result = workspaceStorage.migrate(destination);
    if (result.success) {
      dataDir = workspaceStorage.getRoot();
      store.set('settings', { ...store.get('settings'), dataPath: dataDir });
      // 工作区变化：dsh 运行时下次以新 cwd 重建；内部 Bridge 也按新根重建
      void dshRuntime.restart();
      void dshWebGui.restart();
      const old = internalAgentBridge;
      internalAgentBridge = null;
      void old?.stop();
    }
    return result;
  });
  ipcMain.handle('workspace-backup', () => workspaceStorage.createBackup(BrowserWindow.getFocusedWindow()));
  ipcMain.handle('workspace-restore', () => workspaceStorage.restoreBackup(BrowserWindow.getFocusedWindow()));
  ipcMain.handle('workspace-choose-question-book', () => workspaceStorage.chooseQuestionBook(BrowserWindow.getFocusedWindow()));
  ipcMain.handle('workspace-read-question-book', (_e: any, folder: string) => workspaceStorage.readQuestionBook(folder));
  ipcMain.handle('workspace-choose-book', () => workspaceStorage.chooseBookFile(BrowserWindow.getFocusedWindow()));
  ipcMain.handle('workspace-generate-book-cover', (_e: any, sourcePath: unknown) => {
    if (typeof sourcePath !== 'string' || !sourcePath) return { success: false, error: '书籍路径无效' };
    return workspaceStorage.generateBookCover(sourcePath);
  });
  ipcMain.handle('workspace-open-path', async (_e: any, target: string) => {
    if (typeof target !== 'string' || !isPathWithin(target, getTrustedOpenRoots())) {
      return { success: false, error: '路径不在允许打开的工作区范围内' };
    }
    const error = await shell.openPath(path.resolve(target));
    return error ? { success: false, error } : { success: true, path: path.resolve(target) };
  });
  ipcMain.handle('workspace-open-examples', async () => {
    const examplesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'examples', 'workbench')
      : path.join(__dirname, '..', '..', 'examples', 'workbench');
    if (!fs.existsSync(examplesPath)) return { success: false, error: '案例目录不存在' };
    const error = await shell.openPath(examplesPath);
    return error ? { success: false, error } : { success: true, path: examplesPath };
  });
  ipcMain.handle('workspace-question-book-skill', () => {
    try {
      const directory = app.isPackaged
        ? path.join(process.resourcesPath, 'skills', 'muyujian-question-book-import')
        : path.join(__dirname, '..', '..', 'skills', 'muyujian-question-book-import');
      const skillPath = path.join(directory, 'SKILL.md');
      const promptPath = path.join(directory, 'references', 'agent-prompts.md');
      if (!fs.existsSync(skillPath) || !fs.existsSync(promptPath)) throw new Error('题册整理技能资源缺失');
      return { success: true, directory, skillPath, promptPath, prompt: fs.readFileSync(promptPath, 'utf8') };
    } catch (error: any) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('workspace-notify', (_e: any, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
    return true;
  });
  ipcMain.handle('get-quick-note', () => store.get('quickNote', ''));
  ipcMain.on('save-quick-note', (_e: any, c: string) => store.set('quickNote', c));
  ipcMain.handle('get-settings', () => store.get('settings'));
  ipcMain.on('save-settings', (_e: any, s: any) => { store.set('settings', s); });
  ipcMain.on('update-theme', (_e: any, theme: string) => {
    const color = theme === 'dark' ? '#030712' : '#ffffff';
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(color);
    for (const win of quickNoteWindows) { if (!win.isDestroyed()) win.setBackgroundColor(color); }
    if (todayPlanWindow && !todayPlanWindow.isDestroyed()) todayPlanWindow.setBackgroundColor(color);
  });
  ipcMain.on('win-minimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); });
  ipcMain.on('win-maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    }
  });
  ipcMain.on('win-close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); });
  ipcMain.handle('win-is-maximized', () => mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false);
  ipcMain.on('toggle-quick-note', () => createQuickNoteWindow());
  ipcMain.on('close-quick-note', (e: any) => {
    const win = quickNoteWindows.find(w => !w.isDestroyed() && w.webContents.id === e.sender.id);
    if (win) {
      // 标记为渲染器主动关闭，避免 close 事件重复处理
      if ((win as any).__closingFromRenderer) (win as any).__closingFromRenderer();
      win.webContents.send('save-before-close');
      setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 100);
    }
  });
  ipcMain.on('minimize-quick-note', (e: any) => {
    const win = quickNoteWindows.find(w => !w.isDestroyed() && w.webContents.id === e.sender.id);
    win?.minimize();
  });
  ipcMain.on('toggle-today-plan-window', createTodayPlanWindow);
  ipcMain.on('close-today-plan-window', () => todayPlanWindow?.close());
  ipcMain.on('minimize-today-plan-window', () => todayPlanWindow?.minimize());
  ipcMain.on('set-opacity', (_e: any, opacity: number) => {
    const clamped = clampOpacity(opacity);
    if (todayPlanWindow && !todayPlanWindow.isDestroyed()) todayPlanWindow.setOpacity(clamped);
    store.set('todayPlanOpacity', clamped);
  });
  ipcMain.handle('get-opacity', () => clampOpacity(store.get('todayPlanOpacity')));

  ipcMain.on('toggle-timer-stats-window', createTimerStatsWindow);
  ipcMain.on('close-timer-stats-window', () => timerStatsWindow?.close());
  ipcMain.on('minimize-timer-stats-window', () => timerStatsWindow?.minimize());

  const notesPath = () => path.join(workspaceStorage.getRoot(), 'notes.json');
  const attachmentsPath = () => path.join(workspaceStorage.getRoot(), 'attachments.json');
  const attachmentsDir = () => path.join(workspaceStorage.getRoot(), 'attachments');
  const notifyAllReload = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reload-notes');
    if (todayPlanWindow && !todayPlanWindow.isDestroyed()) todayPlanWindow.webContents.send('reload-notes');
  };

  ipcMain.handle('get-notes', () => { try { const file = notesPath(); return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '[]'; } catch { return '[]'; } });
  ipcMain.handle('get-attachments', () => { try { const file = attachmentsPath(); return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '[]'; } catch { return '[]'; } });
  ipcMain.handle('attachment-write-file', (_e: any, name: unknown, dataUrl: unknown) => {
    try {
      if (typeof name !== 'string' || typeof dataUrl !== 'string') throw new Error('附件参数无效');
      const match = dataUrl.match(/^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,(.+)$/s);
      if (!match) throw new Error('仅支持 PNG/JPEG/GIF/WebP/BMP/AVIF 图片');
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 20 * 1024 * 1024) throw new Error('图片大小不能超过 20MB');
      const ext = match[1];
      const safeBase = path.basename(name).replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60) || 'image';
      const fileName = `${Date.now().toString(36)}-${crypto.randomUUID()}-${safeBase}.${ext}`;
      return enqueueFile(path.join(attachmentsDir(), fileName), () => {
        fs.mkdirSync(attachmentsDir(), { recursive: true });
        fs.writeFileSync(path.join(attachmentsDir(), fileName), buffer);
        return { success: true, fileName };
      });
    } catch (err: any) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('save-attachments', (_e: any, data: string) => {
    // 校验仍在写队列之外完成，写盘本身串行化，避免与其他写入交错
    if (typeof data !== 'string' || data.length > 100 * 1024 * 1024) return { success: false, error: '数据内容无效或超过 100MB 限制' };
    try {
      if (!Array.isArray(JSON.parse(data))) return { success: false, error: '数据格式无效' };
    } catch { return { success: false, error: '数据格式无效' }; }
    return enqueueFile(attachmentsPath(), () => {
      writeAtomic(attachmentsPath(), data);
      return { success: true };
    });
  });
  ipcMain.handle('save-notes', (_e: any, n: string, knownAfter?: number) => {
    if (typeof n !== 'string' || n.length > 100 * 1024 * 1024) return { success: false, error: '数据内容无效或超过 100MB 限制' };
    let incoming: unknown;
    try {
      incoming = JSON.parse(n);
      if (!Array.isArray(incoming)) return { success: false, error: '数据格式无效' };
    } catch { return { success: false, error: '数据格式无效' }; }
    const snapshotTime = typeof knownAfter === 'number' && Number.isFinite(knownAfter) ? knownAfter : 0;
    return enqueueFile(notesPath(), () => {
      // 与磁盘最新内容按 id 合并，避免防抖整文件覆写覆盖其他窗口刚写入的便签
      const merged = mergeNotes(readJsonValue(notesPath(), []), incoming, snapshotTime);
      writeAtomic(notesPath(), JSON.stringify(merged, null, 2));
      notifyAllReload();
      return { success: true };
    });
  });
  ipcMain.handle('create-quick-note', (_e: any, noteJson: string) => {
    let note: any;
    try {
      note = JSON.parse(noteJson);
      if (!note || typeof note !== 'object' || typeof note.id !== 'string') throw new Error('便签内容无效');
    } catch (err: any) { return { success: false, error: err.message }; }
    return enqueueFile(notesPath(), () => {
      const notes = (readJsonValue(notesPath(), []) as any[]);
      notes.unshift(note);
      writeAtomic(notesPath(), JSON.stringify(notes, null, 2));
      notifyAllReload();
      return { success: true, noteId: note.id };
    });
  });
  ipcMain.handle('update-quick-note-content', (_e: any, noteId: string, content: string) => {
    if (typeof noteId !== 'string' || typeof content !== 'string') return { success: false, error: '参数无效' };
    return enqueueFile(notesPath(), () => {
      const notes = (readJsonValue(notesPath(), []) as any[]);
      const idx = notes.findIndex((n: any) => n.id === noteId);
      if (idx === -1) return { success: false, error: 'note not found' };
      notes[idx].content = content;
      notes[idx].updatedAt = Date.now();
      writeAtomic(notesPath(), JSON.stringify(notes, null, 2));
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reload-notes');
      if (todayPlanWindow && !todayPlanWindow.isDestroyed()) todayPlanWindow.webContents.send('reload-notes');
      return { success: true };
    });
  });
  ipcMain.handle('update-quick-note', (_e: any, noteId: string, updates: string) => {
    if (typeof noteId !== 'string' || typeof updates !== 'string') return { success: false, error: '参数无效' };
    let parsed: unknown;
    try { parsed = JSON.parse(updates); } catch (err: any) { return { success: false, error: err.message }; }
    const clean = sanitizeNoteUpdates(parsed);
    delete clean.updatedAt;
    return enqueueFile(notesPath(), () => {
      const notes = (readJsonValue(notesPath(), []) as any[]);
      const idx = notes.findIndex((n: any) => n.id === noteId);
      if (idx === -1) return { success: false, error: 'note not found' };
      Object.assign(notes[idx], clean, { updatedAt: Date.now() });
      writeAtomic(notesPath(), JSON.stringify(notes, null, 2));
      notifyAllReload();
      return { success: true };
    });
  });
  ipcMain.on('reload-notes-from-disk', notifyAllReload);
  ipcMain.on('select-note', (_e: any, noteId: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('select-note', noteId);
  });
  ipcMain.handle('get-data-path', () => workspaceStorage.getRoot());
  ipcMain.handle('export-data', () => {
    let notes: unknown = [];
    let timerRecords: unknown = { records: [] };
    let attachments: unknown = [];
    try { const file = notesPath(); if (fs.existsSync(file)) notes = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    try { const file = timerRecordsPath(); if (fs.existsSync(file)) timerRecords = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    try { const file = attachmentsPath(); if (fs.existsSync(file)) attachments = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    // encryptedAiApiKey 与系统安全存储绑定，agentBridge 含访问 Token，均迁移无效且会泄露访问权，导出时剔除
    const { encryptedAiApiKey: _omittedApiKey, agentBridge: _omittedBridge, ...exportablePreferences } = store.store as unknown as Record<string, unknown>;
    return JSON.stringify({ version: 3, exportedAt: Date.now(), preferences: exportablePreferences, notes, timerRecords, attachments }, null, 2);
  });
  ipcMain.handle('import-data', (_e: any, data: string) => {
    try {
      const backup = JSON.parse(data);
      if (!backup || typeof backup !== 'object') return { success: false, error: 'invalid backup' };
      const preferences = backup.preferences && typeof backup.preferences === 'object' ? backup.preferences : backup;
      Object.keys(preferences).forEach((key) => {
        if (!['version', 'exportedAt', 'notes', 'timerRecords', 'attachments', 'encryptedAiApiKey', 'agentBridge'].includes(key)) store.set(key, preferences[key]);
      });
      if (Array.isArray(backup.notes)) fs.writeFileSync(notesPath(), JSON.stringify(backup.notes, null, 2), 'utf-8');
      if (backup.timerRecords && typeof backup.timerRecords === 'object') fs.writeFileSync(timerRecordsPath(), JSON.stringify(backup.timerRecords, null, 2), 'utf-8');
      if (Array.isArray(backup.attachments)) fs.writeFileSync(attachmentsPath(), JSON.stringify(backup.attachments, null, 2), 'utf-8');
      notifyAllReload();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('workspace-plan-skill', () => {
    try {
      const directory = app.isPackaged
        ? path.join(process.resourcesPath, 'skills', 'muyujian-plan-import')
        : path.join(__dirname, '..', '..', 'skills', 'muyujian-plan-import');
      const skillPath = path.join(directory, 'SKILL.md');
      const promptPath = path.join(directory, 'references', 'agent-prompts.md');
      if (!fs.existsSync(skillPath) || !fs.existsSync(promptPath)) throw new Error('计划整理技能资源缺失');
      return { success: true, directory, skillPath, promptPath, prompt: fs.readFileSync(promptPath, 'utf8') };
    } catch (error: any) { return { success: false, error: error.message }; }
  });
  // 导出 Word：用 pandoc 将原始 Markdown/LaTeX 编译为 docx
  ipcMain.handle('export-word', async (_e: any, title: string, rawContent: string) => {
    const content = resolveAttachmentTokens(rawContent);
    const { dialog } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'no window' };
    const result = await dialog.showSaveDialog(win, {
      title: '导出为 Word', defaultPath: `${title}.docx`,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: 'cancelled' };
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    // 根据内容判断格式
    const isLatex = /\\documentclass|\\begin\{document\}/.test(content);
    const ext = isLatex ? '.tex' : '.md';
    const inputFormat = isLatex ? 'latex' : 'markdown+tex_math_dollars';
    const tmpInput = path.join(tmpDir, `muyujian_export_${ts}${ext}`);
    const tmpOutput = path.join(tmpDir, `muyujian_export_${ts}.docx`);
    try {
      // LaTeX 片段需要包裹成完整文档
      const source = isLatex ? content
        : /\\begin\{(equation|align|gather|eqnarray)\*?\}/.test(content)
          ? `\\documentclass[12pt]{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n${content}\n\\end{document}`
          : content;
      const finalFormat = isLatex || /\\begin\{(equation|align|gather|eqnarray)\*?\}/.test(content) ? 'latex' : inputFormat;
      fs.writeFileSync(tmpInput, source, 'utf-8');
      await runPandoc([tmpInput, '-f', finalFormat, '-t', 'docx', '--mathml', '-o', tmpOutput]);
      fs.copyFileSync(tmpOutput, result.filePath);
      return { success: true, path: result.filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      try { fs.unlinkSync(tmpInput); } catch {}
      try { fs.unlinkSync(tmpOutput); } catch {}
    }
  });
  // 导出 PDF：用 pandoc + xelatex 编译（需要用户已安装 LaTeX 发行版）
  ipcMain.handle('export-pdf', async (_e: any, title: string, rawContent: string) => {
    const content = resolveAttachmentTokens(rawContent);
    const { dialog } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'no window' };
    const result = await dialog.showSaveDialog(win, {
      title: '导出为 PDF', defaultPath: `${title}.pdf`,
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: 'cancelled' };
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const isLatex = /\\documentclass|\\begin\{document\}/.test(content);
    const ext = isLatex ? '.tex' : '.md';
    const inputFormat = isLatex ? 'latex' : 'markdown+tex_math_dollars';
    const tmpInput = path.join(tmpDir, `muyujian_pdf_${ts}${ext}`);
    const tmpOutput = path.join(tmpDir, `muyujian_pdf_${ts}.pdf`);
    try {
      const source = isLatex ? content
        : /\\begin\{(equation|align|gather|eqnarray)\*?\}/.test(content)
          ? `\\documentclass[12pt]{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n${content}\n\\end{document}`
          : content;
      const finalFormat = isLatex || /\\begin\{(equation|align|gather|eqnarray)\*?\}/.test(content) ? 'latex' : inputFormat;
      fs.writeFileSync(tmpInput, source, 'utf-8');
      let lastError: Error | null = null;
      for (const font of PDF_CJK_FONT_CANDIDATES) {
        try {
          await runPandoc([tmpInput, '-f', finalFormat, '-t', 'pdf', '--pdf-engine=xelatex', '-V', `CJKmainfont=${font}`, '-V', 'geometry:margin=2.5cm', '-o', tmpOutput]);
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
        }
      }
      if (lastError) throw new Error(`PDF 编译失败，未能使用常见中文字体完成排版（已尝试 ${PDF_CJK_FONT_CANDIDATES.join(' / ')}）：${lastError.message}`);
      fs.copyFileSync(tmpOutput, result.filePath);
      return { success: true, path: result.filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      try { fs.unlinkSync(tmpInput); } catch {}
      try { fs.unlinkSync(tmpOutput); } catch {}
    }
  });
  ipcMain.handle('pandoc-compile', async (_e: any, rawSource: string, fromFormat: string = 'latex') => {
    const source = resolveAttachmentTokens(rawSource);
    const tmpDir = os.tmpdir();
    const ext = fromFormat === 'latex' ? '.tex' : fromFormat === 'rst' ? '.rst' : fromFormat === 'html' ? '.html' : '.md';
    const tmpInput = path.join(tmpDir, `muyujian_${Date.now()}${ext}`);
    const tmpOutput = path.join(tmpDir, `muyujian_${Date.now()}.html`);
    try {
      fs.writeFileSync(tmpInput, source, 'utf-8');
      await runPandoc([tmpInput, '-f', fromFormat, '-t', 'html5', '--mathjax', '-o', tmpOutput]);
      let html = fs.readFileSync(tmpOutput, 'utf-8');
      html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      return { success: true, html };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      try { fs.unlinkSync(tmpInput); } catch {}
      try { fs.unlinkSync(tmpOutput); } catch {}
    }
  });

  // 任务计时记录
  const timerRecordsPath = () => path.join(workspaceStorage.getRoot(), 'task-timer-records.json');

  ipcMain.handle('save-timer-record', (_e: any, record: any) => {
    if (!record || typeof record !== 'object') return { success: false, error: '记录无效' };
    return enqueueFile(timerRecordsPath(), () => {
      const data: any = (readJsonValue(timerRecordsPath(), { records: [] }) as any) || { records: [] };
      if (!Array.isArray(data.records)) data.records = [];
      data.records.push(record);
      if (data.records.length > 1000) data.records = data.records.slice(-1000);
      writeAtomic(timerRecordsPath(), JSON.stringify(data, null, 2));
      return { success: true };
    });
  });

  ipcMain.handle('get-timer-records', () => {
    try { const file = timerRecordsPath(); if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8'); } catch {}
    return '{"records":[]}';
  });

  ipcMain.handle('save-active-session', (_e: any, session: any) => {
    return enqueueFile(timerRecordsPath(), () => {
      const data: any = (readJsonValue(timerRecordsPath(), { records: [] }) as any) || { records: [] };
      data.activeSession = session || undefined;
      writeAtomic(timerRecordsPath(), JSON.stringify(data, null, 2));
      return { success: true };
    });
  });

  ipcMain.handle('load-active-session', () => {
    try {
      const file = timerRecordsPath();
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return data.activeSession || null;
      }
    } catch {}
    return null;
  });

  // ---- Agent Bridge（对外接入 Agent 的本地桥服务）----
  const getBridgeOptions = (): BridgeOptions => {
    const saved = store.get('agentBridge');
    return {
      enabled: Boolean(saved?.enabled),
      bind: saved?.bind === 'lan' ? 'lan' : 'loopback',
      token: saved?.token || '',
    };
  };
  const applyBridge = async (): Promise<BridgeOptions & { status: ReturnType<AgentBridge['status']> }> => {
    const options = getBridgeOptions();
    if (options.enabled && !options.token) {
      // 首次开启时生成 token
      store.set('agentBridge.token', generateBridgeToken());
      return applyBridge();
    }
    if (options.enabled) {
      if (!agentBridge) agentBridge = new AgentBridge(options, { workspaceRoot: () => workspaceStorage.getRoot() });
      agentBridge.updateOptions(options);
      await agentBridge.start();
    } else if (agentBridge) {
      await agentBridge.stop();
    }
    return { ...options, token: options.token, status: agentBridge ? agentBridge.status() : { running: false, host: '', port: 0, url: '', allowedIpsNote: '' } };
  };

  ipcMain.handle('agent-bridge-get', async () => {
    const options = getBridgeOptions();
    return { ...options, status: agentBridge ? agentBridge.status() : null, audit: agentBridge ? agentBridge.auditTrail().slice(-10) : [] };
  });
  ipcMain.handle('agent-bridge-save', async (_e: any, value: unknown) => {
    try {
      const input = (value && typeof value === 'object' ? value : {}) as { enabled?: unknown; bind?: unknown };
      const current = store.get('agentBridge') || { enabled: false, bind: 'loopback' as const, token: generateBridgeToken() };
      const next = {
        enabled: Boolean(input.enabled),
        bind: input.bind === 'lan' ? 'lan' as const : 'loopback' as const,
        token: current.token || generateBridgeToken(),
      };
      store.set('agentBridge', next);
      const applied = await applyBridge();
      return { success: true, ...applied };
    } catch (error: any) { return { success: false, error: error?.message || 'Agent Bridge 启动失败' }; }
  });
  ipcMain.handle('agent-bridge-reset-token', async () => {
    store.set('agentBridge.token', generateBridgeToken());
    return { success: true, token: store.get('agentBridge')?.token };
  });
  ipcMain.handle('agent-bridge-token', () => store.get('agentBridge')?.token || '');
  // 若上次开启了桥服务，启动时自动拉起
  void applyBridge();
}

function createMenu(): void {
  const isMac = process.platform === 'darwin';
  const sep = { type: 'separator' as const };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' as const, label: '暮雨笺' }] : []),
    { label: '文件', submenu: [
      { label: '新建便签', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('new-note') },
      { label: '速记', accelerator: 'Alt+Q', click: () => createQuickNoteWindow() },
      sep,
      { label: '导出数据', click: () => mainWindow?.webContents.send('export-data') },
      { label: '导入数据', click: () => mainWindow?.webContents.send('import-data') },
      sep,
      isMac ? { role: 'close' as const, label: '关闭窗口' } : { role: 'quit' as const, label: '退出' },
    ]},
    { label: '编辑', submenu: [
      { role: 'undo' as const, label: '撤销' }, { role: 'redo' as const, label: '重做' }, sep,
      { role: 'cut' as const, label: '剪切' }, { role: 'copy' as const, label: '复制' }, { role: 'paste' as const, label: '粘贴' }, { role: 'selectAll' as const, label: '全选' },
    ]},
    { label: '视图', submenu: [
      ...(app.isPackaged ? [] : [
        { role: 'reload' as const, label: '重新加载' }, { role: 'forceReload' as const, label: '强制重新加载' }, { role: 'toggleDevTools' as const, label: '开发者工具' }, sep,
      ]),
      { role: 'resetZoom' as const, label: '重置缩放' }, { role: 'zoomIn' as const, label: '放大' }, { role: 'zoomOut' as const, label: '缩小' }, sep,
      { role: 'togglefullscreen' as const, label: '全屏' },
    ]},
    { label: '窗口', submenu: [
      { role: 'minimize' as const, label: '最小化' }, { role: 'zoom' as const, label: '缩放' },
      ...(isMac ? [sep, { role: 'front' as const, label: '前置所有窗口' }] : []),
    ]},
  ]));
}

app.whenReady().then(() => {
  workspaceStorage = new WorkspaceStorage(dataDir);
  dataDir = workspaceStorage.getRoot();
  knowledgeService = new KnowledgeService(() => workspaceStorage.getRoot());
  createMenu();
  createInitialNotes();
  setupIPC();
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { stopDshConfigWatcher(); void agentBridge?.stop(); void internalAgentBridge?.stop(); void dshRuntime.close(); void dshWebGui.stop(); });
