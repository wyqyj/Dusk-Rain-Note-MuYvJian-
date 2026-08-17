import { app, BrowserWindow, ipcMain, Menu, Notification, screen, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import Store from 'electron-store';
import { WorkspaceStorage } from './workspaceStorage';

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

interface AppStore {
  quickNote: string;
  settings: { theme: 'light' | 'dark'; textMode: string; quickNoteShortcut: string; autoSaveInterval: number; dataPath: string; };
  windowBounds?: { x: number; y: number; width: number; height: number };
  quickNoteBounds?: { x: number; y: number; width: number; height: number };
  todayPlanBounds?: { x: number; y: number; width: number; height: number };
  todayPlanOpacity?: number;
  initialized?: boolean;
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

function readUpdateNotices(): string {
  try { return fs.readFileSync(updateNoticesPath, 'utf-8'); }
  catch { return '# 暮雨笺更新告示\n\n未能读取内置更新记录，请在项目根目录查看 UPDATE_NOTICES.md。'; }
}

function createInitialNotes(): void {
  try {
    if (store.get('initialized')) return;
    const notesPath = path.join(dataDir, 'notes.json');
    let notes: any[] = [];
    try { if (fs.existsSync(notesPath)) notes = JSON.parse(fs.readFileSync(notesPath, 'utf-8')); } catch {}
    if (notes.length > 0) { store.set('initialized', true); return; }
    store.set('initialized', true);
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
  } catch (err) { console.error('创建预置笔记失败:', err); }
}

let mainWindow: BrowserWindow | null = null;
let workspaceStorage: WorkspaceStorage;
const quickNoteWindows: BrowserWindow[] = [];
const MAX_QUICK_NOTE_WINDOWS = 10;
let todayPlanWindow: BrowserWindow | null = null;
let timerStatsWindow: BrowserWindow | null = null;
let lastQuickNoteCreateTime = 0;
let contentSecurityPolicyInstalled = false;

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
    const headers = { ...details.responseHeaders };
    headers['Content-Security-Policy'] = [
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file: blob:; font-src 'self' data:; connect-src 'self' http://localhost:5173 ws://localhost:5173; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'",
    ];
    callback({ responseHeaders: headers });
  });
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  installContentSecurityPolicy(mainWindow);
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  if (fs.existsSync(rendererPath)) mainWindow.loadFile(rendererPath);
  else mainWindow.loadURL('http://localhost:5173');
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
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  if (fs.existsSync(rendererPath)) win.loadFile(rendererPath, { hash: '/quick-note' });
  else win.loadURL('http://localhost:5173#/quick-note');
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
  const savedOpacity = store.get('todayPlanOpacity') ?? 1;
  todayPlanWindow = new BrowserWindow({
    width: savedBounds?.width || 420, height: savedBounds?.height || 600,
    x: savedBounds?.x, y: savedBounds?.y,
    frame: false, alwaysOnTop: true, resizable: true, movable: true,
    title: '暮雨笺 · 待办',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  todayPlanWindow.setOpacity(savedOpacity);
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  if (fs.existsSync(rendererPath)) todayPlanWindow.loadFile(rendererPath, { hash: '/today-plan' });
  else todayPlanWindow.loadURL('http://localhost:5173#/today-plan');
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
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  if (fs.existsSync(rendererPath)) timerStatsWindow.loadFile(rendererPath, { hash: '/timer-stats' });
  else timerStatsWindow.loadURL('http://localhost:5173#/timer-stats');
  timerStatsWindow.once('ready-to-show', () => timerStatsWindow?.show());
  timerStatsWindow.on('closed', () => { timerStatsWindow = null; });
}

function setupIPC(): void {
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
    createInitialNotes();
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
  ipcMain.handle('workspace-migrate', (_e: any, destination: string) => workspaceStorage.migrate(destination));
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
    if (todayPlanWindow && !todayPlanWindow.isDestroyed()) {
      todayPlanWindow.setOpacity(Math.max(0.2, Math.min(1, opacity)));
      store.set('todayPlanOpacity', opacity);
    }
  });
  ipcMain.handle('get-opacity', () => store.get('todayPlanOpacity') ?? 1);

  ipcMain.on('toggle-timer-stats-window', createTimerStatsWindow);
  ipcMain.on('close-timer-stats-window', () => timerStatsWindow?.close());
  ipcMain.on('minimize-timer-stats-window', () => timerStatsWindow?.minimize());

  const notesPath = () => path.join(workspaceStorage.getRoot(), 'notes.json');
  const attachmentsPath = () => path.join(workspaceStorage.getRoot(), 'attachments.json');
  const notifyAllReload = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reload-notes');
    if (todayPlanWindow && !todayPlanWindow.isDestroyed()) todayPlanWindow.webContents.send('reload-notes');
  };

  ipcMain.handle('get-notes', () => { try { const file = notesPath(); return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '[]'; } catch { return '[]'; } });
  ipcMain.handle('get-attachments', () => { try { const file = attachmentsPath(); return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '[]'; } catch { return '[]'; } });
  ipcMain.handle('save-attachments', (_e: any, data: string) => {
    return writePayload(attachmentsPath(), data, 'array');
  });
  ipcMain.handle('save-notes', (_e: any, n: string) => {
    const result = writePayload(notesPath(), n, 'array');
    if (result.success) notifyAllReload();
    return result;
  });
  ipcMain.handle('create-quick-note', (_e: any, noteJson: string) => {
    try {
      let notes: any[] = [];
      try { const file = notesPath(); if (fs.existsSync(file)) notes = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { notes = []; }
      const note = JSON.parse(noteJson);
      notes.unshift(note);
      fs.writeFileSync(notesPath(), JSON.stringify(notes, null, 2), 'utf-8');
      notifyAllReload();
      return { success: true, noteId: note.id };
    } catch (err: any) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('update-quick-note-content', (_e: any, noteId: string, content: string) => {
    try {
      let notes: any[] = [];
      try { const file = notesPath(); if (fs.existsSync(file)) notes = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { notes = []; }
      const idx = notes.findIndex((n: any) => n.id === noteId);
      if (idx === -1) return { success: false, error: 'note not found' };
      notes[idx].content = content;
      notes[idx].updatedAt = Date.now();
      fs.writeFileSync(notesPath(), JSON.stringify(notes, null, 2), 'utf-8');
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reload-notes');
      if (todayPlanWindow && !todayPlanWindow.isDestroyed()) todayPlanWindow.webContents.send('reload-notes');
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('update-quick-note', (_e: any, noteId: string, updates: string) => {
    try {
      let notes: any[] = [];
      try { const file = notesPath(); if (fs.existsSync(file)) notes = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { notes = []; }
      const idx = notes.findIndex((n: any) => n.id === noteId);
      if (idx === -1) return { success: false, error: 'note not found' };
      Object.assign(notes[idx], JSON.parse(updates), { updatedAt: Date.now() });
      fs.writeFileSync(notesPath(), JSON.stringify(notes, null, 2), 'utf-8');
      notifyAllReload();
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });
  ipcMain.on('reload-notes-from-disk', notifyAllReload);
  ipcMain.on('select-note', (_e: any, noteId: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('select-note', noteId);
  });
  ipcMain.handle('get-data-path', () => dataDir);
  ipcMain.handle('export-data', () => {
    let notes: unknown = [];
    let timerRecords: unknown = { records: [] };
    let attachments: unknown = [];
    try { const file = notesPath(); if (fs.existsSync(file)) notes = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    try { const file = timerRecordsPath(); if (fs.existsSync(file)) timerRecords = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    try { const file = attachmentsPath(); if (fs.existsSync(file)) attachments = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    return JSON.stringify({ version: 3, exportedAt: Date.now(), preferences: store.store, notes, timerRecords, attachments }, null, 2);
  });
  ipcMain.handle('import-data', (_e: any, data: string) => {
    try {
      const backup = JSON.parse(data);
      if (!backup || typeof backup !== 'object') return { success: false, error: 'invalid backup' };
      const preferences = backup.preferences && typeof backup.preferences === 'object' ? backup.preferences : backup;
      Object.keys(preferences).forEach((key) => {
        if (!['version', 'exportedAt', 'notes', 'timerRecords', 'attachments'].includes(key)) store.set(key, preferences[key]);
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
  ipcMain.handle('export-word', async (_e: any, title: string, content: string) => {
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
      await new Promise<void>((resolve, reject) => {
        execFile(pandocPath, [tmpInput, '-f', finalFormat, '-t', 'docx', '--mathml', '-o', tmpOutput], (err) => {
          if (err) reject(err); else resolve();
        });
      });
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
  ipcMain.handle('export-pdf', async (_e: any, title: string, content: string) => {
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
      await new Promise<void>((resolve, reject) => {
        execFile(pandocPath, [
          tmpInput, '-f', finalFormat, '-t', 'pdf',
          '--pdf-engine=xelatex',
          '-V', 'CJKmainfont=Microsoft YaHei',
          '-V', 'geometry:margin=2.5cm',
          '-o', tmpOutput,
        ], (err) => {
          if (err) reject(err); else resolve();
        });
      });
      fs.copyFileSync(tmpOutput, result.filePath);
      return { success: true, path: result.filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      try { fs.unlinkSync(tmpInput); } catch {}
      try { fs.unlinkSync(tmpOutput); } catch {}
    }
  });
  ipcMain.handle('pandoc-compile', async (_e: any, source: string, fromFormat: string = 'latex') => {
    const tmpDir = os.tmpdir();
    const ext = fromFormat === 'latex' ? '.tex' : fromFormat === 'rst' ? '.rst' : fromFormat === 'html' ? '.html' : '.md';
    const tmpInput = path.join(tmpDir, `muyujian_${Date.now()}${ext}`);
    const tmpOutput = path.join(tmpDir, `muyujian_${Date.now()}.html`);
    try {
      fs.writeFileSync(tmpInput, source, 'utf-8');
      await new Promise<void>((resolve, reject) => {
        execFile(pandocPath, [tmpInput, '-f', fromFormat, '-t', 'html5', '--mathjax', '-o', tmpOutput], (err) => {
          if (err) reject(err); else resolve();
        });
      });
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
    try {
      let data: any = { records: [] };
      try { const file = timerRecordsPath(); if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
      if (!data.records) data.records = [];
      data.records.push(record);
      if (data.records.length > 1000) data.records = data.records.slice(-1000);
      fs.writeFileSync(timerRecordsPath(), JSON.stringify(data, null, 2), 'utf-8');
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('get-timer-records', () => {
    try { const file = timerRecordsPath(); if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8'); } catch {}
    return '{"records":[]}';
  });

  ipcMain.handle('save-active-session', (_e: any, session: any) => {
    try {
      let data: any = { records: [] };
      try { const file = timerRecordsPath(); if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
      data.activeSession = session || undefined;
      fs.writeFileSync(timerRecordsPath(), JSON.stringify(data, null, 2), 'utf-8');
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
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
      { role: 'reload' as const, label: '重新加载' }, { role: 'forceReload' as const, label: '强制重新加载' }, { role: 'toggleDevTools' as const, label: '开发者工具' }, sep,
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
  createMenu();
  createInitialNotes();
  setupIPC();
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
