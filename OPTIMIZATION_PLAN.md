# 暮雨笺 (MuYuJian) v3.0.4 — 全面优化方案

> 生成日期：2025-08-17
> 适用版本：v3.0.4 (54abeae)
> 代码规模：~8,000 行 TypeScript + ~700 行 CSS + ~200 行 配置

---

## 目录

1. [项目架构概览](#一项目架构概览)
2. [问题诊断汇总](#二问题诊断汇总)
3. [Phase 1：安全加固](#三phase-1安全加固-p0)
4. [Phase 2：架构拆分](#四phase-2架构拆分-p0)
5. [Phase 3：性能优化](#五phase-3性能优化-p1)
6. [Phase 4：代码质量](#六phase-4代码质量-p2)
7. [Phase 5：功能增强](#七phase-5功能增强-p3)
8. [Phase 6：工程化](#八phase-6工程化-p4)
9. [实施路线图](#九实施路线图)

---

## 一、项目架构概览

### 1.1 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面壳 | Electron | 33.3 |
| UI 框架 | React | 18.3 |
| 语言 | TypeScript | 5.7 |
| 样式 | Tailwind CSS | 3.4 |
| 状态管理 | Zustand | 5.0 |
| 编辑器 | CodeMirror 6 | — |
| 公式渲染 | KaTeX | 0.16 |
| Markdown | markdown-it | 14.1 |
| 图表 | Recharts | 3.8 |
| 导出 | Pandoc (外部) | — |
| 打包 | electron-builder | 25.1 |

### 1.2 源码结构

```
src/
├── main/                          # Electron 主进程
│   ├── index.ts              (678 行)  ← 全部逻辑集中于此
│   ├── preload.ts            (83 行)   ← IPC 桥接
│   ├── workspaceStorage.ts   (219 行)  ← 工作台文件操作
│   └── electron.d.ts         (86 行)   ← 手动类型声明
├── renderer/                        # React 渲染进程
│   ├── App.tsx               (332 行)  ← 根组件
│   ├── index.tsx             (24 行)   ← 路由分发
│   ├── components/
│   │   ├── StudyWorkbench.tsx (419 行)  ← 全部工作台逻辑
│   │   ├── Sidebar.tsx       (591 行)  ← 侧边栏
│   │   ├── CanvasBoard.tsx   (364 行)  ← 无限画布
│   │   ├── Editor.tsx        (277 行)  ← 编辑器
│   │   ├── QuickNote.tsx     (211 行)  ← 速记窗口
│   │   ├── TodayPlanWindow.tsx (376 行) ← 待办悬浮窗
│   │   ├── Preview.tsx       (206 行)  ← 预览面板
│   │   ├── TimerStatsWindow.tsx (195 行) ← 统计窗口
│   │   ├── CountdownBadge.tsx (102 行)
│   │   ├── TodayPlan.tsx     (142 行)
│   │   └── ... (6 个小组件)
│   ├── store/
│   │   ├── noteStore.ts      (312 行)  ← 便签核心状态
│   │   ├── timerStore.ts     (193 行)  ← 计时 + 截止时间
│   │   ├── settingsStore.ts  (71 行)
│   │   ├── attachmentStore.ts (60 行)
│   │   └── uiStore.ts        (49 行)
│   ├── utils/
│   │   ├── markdown.ts       (530 行)  ← Markdown/LaTeX 渲染
│   │   ├── i18n.ts           (180 行)  ← 文字风格
│   │   └── useAutoSave.ts    (59 行)
│   └── styles/
│       └── index.css         (693 行)  ← 全部样式集中
```

### 1.3 数据流

```
┌─────────────┐     IPC      ┌──────────────┐     文件系统     ┌──────────────┐
│  Renderer    │ ──────────→ │  Main Process │ ──────────────→ │  磁盘文件     │
│  (React)     │             │  (Electron)   │                 │              │
│              │ ←────────── │              │ ←────────────── │              │
│  Zustand     │  IPC        │  IPC Handler  │  fs.readFileSync│  notes.json  │
│  Store       │             │              │                 │  workspace   │
└─────────────┘             └──────────────┘                 │  attachments │
                                                              └──────────────┘
```

**当前问题**：所有数据变更都走 `JSON.stringify(全量notes)` → `fs.writeFileSync`，无增量写入。

---

## 二、问题诊断汇总

### 严重度分级

| 等级 | 含义 | 数量 |
|------|------|------|
| 🔴 P0 | 必须修复 — 安全/架构阻塞 | 4 |
| 🟠 P1 | 强烈建议 — 显著性能/质量提升 | 5 |
| 🟡 P2 | 建议 — 可维护性/规范性 | 4 |
| 🟢 P3 | 可选 — 功能增强 | 5 |
| 🔵 P4 | 可选 — 工程化 | 3 |

### 问题清单

| # | 等级 | 问题 | 影响范围 | 文件 |
|---|------|------|---------|------|
| 1 | 🔴 | `dangerouslySetInnerHTML` 无 XSS 消毒 | 安全 | `markdown.ts`, `Sidebar.tsx`, `StudyWorkbench.tsx` |
| 2 | 🔴 | 无 Content Security Policy | 安全 | `main/index.ts` |
| 3 | 🔴 | 主进程 678 行单文件 | 架构 | `main/index.ts` |
| 4 | 🔴 | StudyWorkbench 419 行 + 20 useState | 架构 | `StudyWorkbench.tsx` |
| 5 | 🟠 | 附件 Base64 存储在 JSON 中 | 性能 | `attachmentStore.ts` |
| 6 | 🟠 | Markdown 同步渲染阻塞主线程 | 性能 | `markdown.ts` |
| 7 | 🟠 | 画布无虚拟化 | 性能 | `CanvasBoard.tsx` |
| 8 | 🟠 | 全量序列化保存 | 性能 | `noteStore.ts` |
| 9 | 🟠 | 编辑器无防抖，每次击键触发保存 | 性能 | `Editor.tsx` |
| 10 | 🟡 | TypeScript 类型不严格 (`any`/手动声明) | 质量 | 多处 |
| 11 | 🟡 | 核心类型分散在组件文件中 | 质量 | `StudyWorkbench.tsx` |
| 12 | 🟡 | CSS 混用 Tailwind 和自定义 class | 质量 | `index.css` |
| 13 | 🟡 | i18n 仅覆盖部分 UI 文案 | 质量 | `i18n.ts` |
| 14 | 🟢 | 搜索仅做 includes 字符串匹配 | 功能 | `Sidebar.tsx` |
| 15 | 🟢 | 版本历史固定 20 个，无差异对比 | 功能 | `noteStore.ts` |
| 16 | 🟢 | 导出依赖外部 Pandoc | 功能 | `main/index.ts` |
| 17 | 🟢 | 无自动备份机制 | 功能 | — |
| 18 | 🟢 | 画布无多选/撤销重做 | 功能 | `CanvasBoard.tsx` |
| 19 | 🔵 | 项目零测试覆盖 | 工程 | — |
| 20 | 🔵 | CI 仅做基础校验 | 工程 | `.github/workflows/ci.yml` |
| 21 | 🔵 | 打包缺少代码签名和自动更新 | 工程 | `package.json` |

---

## 三、Phase 1：安全加固 (P0)

### 3.1 XSS 消毒

**现状**：`renderMarkdown()` 返回的 HTML 通过 `dangerouslySetInnerHTML` 直接插入 DOM，用户笔记中的恶意 `<script>` 标签可能被执行。

**影响位置**：
- `Preview.tsx` — `dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}`
- `StudyWorkbench.tsx:192` — `MarkdownContent` 组件
- `CanvasBoard.tsx:349` — 画布文本块 `dangerouslySetInnerHTML`
- `TodayPlanWindow.tsx` — 待办窗口渲染

**方案**：

```bash
npm install dompurify @types/dompurify
```

```typescript
// src/renderer/utils/markdown.ts 末尾增加
import DOMPurify from 'dompurify';

// DOMPurify 配置：允许 KaTeX 渲染的 HTML + 样式
const purifyConfig = {
  ALLOWED_TAGS: [
    'div', 'span', 'p', 'br', 'strong', 'em', 'code', 'pre',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img', 'hr', 'sup', 'sub', 'u', 'details', 'summary',
    'svg', 'line', // KaTeX 内部使用
  ],
  ALLOWED_ATTR: [
    'class', 'style', 'href', 'src', 'alt', 'title',
    'data-title', 'aria-label', 'aria-hidden',
    'viewBox', 'd', 'x1', 'y1', 'x2', 'y2',
    'stroke', 'stroke-width', 'stroke-linecap',
    'fill', 'font-size', 'text-anchor',
  ],
  ALLOW_DATA_ATTR: false,
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, purifyConfig);
}

// 修改 renderMarkdown 函数
export function renderMarkdown(text: string): string {
  const normalized = normalizeMathMarkdown(text);
  let html: string;
  if (isLatexDocument(normalized)) {
    const { text: mathRendered } = preRenderMath(normalized);
    const structured = preprocessLatexStructure(mathRendered);
    html = md.render(preprocessWikiLinks(structured));
  } else {
    html = md.render(preprocessWikiLinks(normalized));
  }
  return sanitizeHtml(html);
}
```

### 3.2 Content Security Policy

**方案**：在主进程 `createMainWindow` 中设置 CSP：

```typescript
// src/main/index.ts → createMainWindow() 内部
mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +  // KaTeX 需要 inline style
        "img-src 'self' data: file: blob:; " +
        "font-src 'self' data:; " +
        "connect-src 'self'; " +
        "object-src 'none'; " +
        "frame-src 'none';"
      ],
    },
  });
});
```

### 3.3 shell.openPath 路径校验

**方案**：对通过工作台打开本地文件的操作做路径白名单校验：

```typescript
// src/main/index.ts
function isPathSafe(targetPath: string, allowedRoots: string[]): boolean {
  try {
    const resolved = path.resolve(targetPath);
    return allowedRoots.some(root => resolved.startsWith(root));
  } catch {
    return false;
  }
}

// 在 workspace-open-path handler 中
ipcMain.handle('workspace-open-path', (_e: any, target: string) => {
  const workspaceRoot = workspaceStorage.getRoot();
  const booksRoot = path.join(workspaceRoot, 'books');
  if (!isPathSafe(target, [booksRoot])) {
    return { success: false, error: '路径不在允许范围内' };
  }
  return shell.openPath(target);
});
```

---

## 四、Phase 2：架构拆分 (P0)

### 4.1 主进程拆分

**目标**：将 `src/main/index.ts`（678 行）拆分为模块化结构。

**新目录结构**：

```
src/main/
├── index.ts                    → 80 行（启动、窗口生命周期）
├── windows/
│   ├── createMain.ts           → 50 行
│   ├── createQuickNote.ts      → 50 行
│   ├── createTodayPlan.ts      → 30 行
│   └── createTimerStats.ts     → 25 行
├── ipc/
│   ├── registerNotes.ts        → 80 行（便签 CRUD）
│   ├── registerWorkspace.ts    → 60 行（工作台状态）
│   ├── registerExport.ts       → 100 行（Word/PDF/HTML 导出）
│   ├── registerTimer.ts        → 40 行（计时记录）
│   └── registerWindow.ts       → 50 行（窗口控制）
├── menu.ts                     → 50 行
├── store.ts                    → 30 行（electron-store 初始化）
├── workspaceStorage.ts         → 不变
├── preload.ts                  → 不变
└── electron.d.ts               → 不变
```

**拆分步骤**：

1. 将 `electron-store` 初始化和默认值提取到 `store.ts`
2. 将 `createWelcomeNote` 移到独立文件或保留原位
3. 4 个窗口创建函数分别提取到 `windows/` 目录
4. IPC handlers 按职责分组到 `ipc/` 目录
5. 菜单模板提取到 `menu.ts`
6. `index.ts` 只保留 `app.whenReady()` 编排逻辑

### 4.2 StudyWorkbench 拆分

**目标**：将 419 行的巨型组件拆分为独立的子视图 + 业务逻辑 Hooks。

**类型定义提取**：

```typescript
// src/renderer/types/workbench.ts
export type Subject = '政治' | '英语' | '数学' | '业务课';
export type TaskBucket = 'daily' | 'monthly' | 'backlog' | 'ignored';
export type Mastery = 1 | 2 | 3 | 4 | 5;
export type BookSort = 'recent' | 'progress' | 'title';

export interface Task {
  id: string;
  title: string;
  subject: Subject;
  date: string;
  completed: boolean;
  bucket: TaskBucket;
  sourceDate?: string;
  due?: string;
}

export interface FocusRecord {
  id: string;
  taskName: string;
  subject: Subject;
  date: string;
  minutes: number;
  completed: boolean;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  shelf: string;
  sourcePath?: string;
  originalPath?: string;
  coverPath?: string;
  progress: number;
  lastOpenedAt?: number;
  noteIds: string[];
  questionBookIds: string[];
}

export interface Question {
  id: string;
  chapter: string;
  number: string;
  status: 'correct' | 'wrong';
  prompt: string;
  answer: string;
  mine?: string;
  reason?: string;
  mastery: Mastery;
  passed: boolean;
  tags: string[];
}

export interface QuestionBook {
  id: string;
  title: string;
  volume: string;
  subject: Subject;
  sourcePath?: string;
  originalPath?: string;
  sourcePaths?: string[];
  originalPaths?: string[];
  canvasId?: string;
  questions: Question[];
  overrides: Record<string, Pick<Question, 'mastery' | 'passed' | 'tags'>>;
}

export interface Workspace {
  version: 3;
  examDate: string;
  phases: { name: string; start: string; end: string }[];
  tasks: Task[];
  focusRecords: FocusRecord[];
  shelves: string[];
  books: Book[];
  questionBooks: QuestionBook[];
  checkins: string[];
  customTags: string[];
}
```

**Hooks 提取**：

```typescript
// src/renderer/hooks/useWorkspace.ts
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace());
  const [loaded, setLoaded] = useState(false);

  // 加载、保存、mutations ...
  const mutate = (fn: (w: Workspace) => Workspace) => setWorkspace(fn);

  return { workspace, loaded, mutate, ... };
}

// src/renderer/hooks/useFocusTimer.ts
export function useFocusTimer(workspace: Workspace, mutate: MutateFn) {
  const [activeFocus, setActiveFocus] = useState<...>(null);
  // 开始、暂停、结束逻辑 ...
  return { activeFocus, startFocus, pauseFocus, finishFocus };
}

// src/renderer/hooks/useQuestionBook.ts
export function useQuestionBook(workspace: Workspace, mutate: MutateFn) {
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [questionFilter, setQuestionFilter] = useState<...>('all');
  // 导入、刷新、更新题目逻辑 ...
  return { ... };
}

// src/renderer/hooks/useBookshelf.ts
export function useBookshelf(workspace: Workspace, mutate: MutateFn) {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [bookSearch, setBookSearch] = useState('');
  const [bookShelfFilter, setBookShelfFilter] = useState('all');
  // 导入、删除、排序逻辑 ...
  return { ... };
}
```

**子视图拆分**：

```
src/renderer/components/workbench/
├── StudyWorkbench.tsx       → 壳组件，组合各子视图
├── OverviewView.tsx         → 总览（倒计时、今日任务、打卡热力图）
├── PlanView.tsx             → 规划（每日任务、计划文件、月综合）
├── FocusView.tsx            → 专注（计时器、统计、打卡图片导出）
├── BookshelfView.tsx        → 书架（书籍网格、搜索、详情面板）
├── QuestionBookView.tsx     → 题册（章节目录、题目卡片、筛选）
├── NotesView.tsx            → 笔记（列表 + 编辑 + 预览）
├── CanvasView.tsx           → 画布（画布列表 + CanvasBoard）
└── SettingsView.tsx         → 设置（引导、壁纸、数据、案例）
```

### 4.3 类型安全 IPC

**目标**：为所有 IPC 通道建立类型安全的调用协议。

```typescript
// src/shared/ipc-types.ts
export interface IpcChannels {
  // 便签
  'get-notes': { return: string };
  'save-notes': { args: [string]; return: { success: boolean } };
  'create-quick-note': { args: [string]; return: { success: boolean; noteId?: string; error?: string } };
  // 工作台
  'workspace-get-state': { return: string };
  'workspace-save-state': { args: [string]; return: { success: boolean; error?: string } };
  // 导出
  'export-word': { args: [string, string]; return: { success: boolean; path?: string; error?: string } };
  'export-pdf': { args: [string, string]; return: { success: boolean; path?: string; error?: string } };
  // ... 所有通道
}

// preload.ts 中可按此类型安全地暴露 API
```

---

## 五、Phase 3：性能优化 (P1)

### 5.1 附件存储重构

**现状**：`attachments.json` 将所有图片以 base64 编码存储在单个 JSON 文件中，与便签一起加载。

**影响**：
- 10 张 1MB 图片 → `attachments.json` 膨胀到 ~13MB
- 启动时必须完整加载，首次打开可能卡顿 3-5 秒
- 便签保存时全量序列化包含附件数据

**方案**：

```
data/
├── attachments/
│   ├── {id}.png          ← 原始文件
│   ├── {id}.jpg
│   └── ...
├── attachments.json      ← 仅元数据
└── notes.json
```

```typescript
// attachments.json 新结构
interface AttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  fileName: string; // 磁盘文件名 {id}.{ext}
}

// 主进程新增 IPC
ipcMain.handle('read-attachment-file', (_e, id: string, mimeType: string) => {
  const ext = mimeType.split('/')[1] || 'bin';
  const filePath = path.join(workspaceStorage.getRoot(), 'attachments', `${id}.${ext}`);
  if (!fs.existsSync(filePath)) return { success: false };
  return { success: true, dataUrl: `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}` };
});
```

- 渲染器按需加载附件（懒加载，仅在显示时读取）
- 大幅减少启动时的数据加载量

### 5.2 Markdown Web Worker

**目标**：将 KaTeX 预渲染和 markdown-it 渲染移至 Web Worker，避免阻塞主线程。

```typescript
// src/renderer/workers/markdown.worker.ts
self.onmessage = (event: MessageEvent<{ id: string; text: string }>) => {
  const { id, text } = event.data;
  // 执行 renderMarkdown(text) — 在 Worker 线程
  const html = renderMarkdown(text);
  self.postMessage({ id, html });
};

// src/renderer/utils/markdownAsync.ts
const worker = new Worker(new URL('../workers/markdown.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<string, (html: string) => void>();

worker.onmessage = (event) => {
  const { id, html } = event.data;
  pending.get(id)?.(html);
  pending.delete(id);
};

export function renderMarkdownAsync(text: string): Promise<string> {
  return new Promise((resolve) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    pending.set(id, resolve);
    worker.postMessage({ id, text });
  });
}
```

### 5.3 Store 增量保存

**目标**：消除每次击键触发的全量 `JSON.stringify(notes)` 保存。

**方案 A（推荐）**：主进程维护内存缓存

```typescript
// src/main/ipc/registerNotes.ts
let notesCache: any[] | null = null;

function loadNotesFromDisk(): any[] {
  if (notesCache) return notesCache;
  const file = notesPath();
  notesCache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
  return notesCache;
}

// 增量更新单条便签
ipcMain.handle('patch-note', (_e, id: string, patch: string) => {
  const notes = loadNotesFromDisk();
  const idx = notes.findIndex((n: any) => n.id === id);
  if (idx === -1) return { success: false };
  Object.assign(notes[idx], JSON.parse(patch), { updatedAt: Date.now() });
  scheduleSave(notes);
  return { success: true };
});

let saveTimeout: NodeJS.Timeout | null = null;
function scheduleSave(notes: any[]) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    fs.writeFileSync(notesPath(), JSON.stringify(notes, null, 2), 'utf-8');
    notifyAllReload();
  }, 300);
}
```

**方案 B（简化）**：前端 debounce 增强

```typescript
// noteStore.ts 中的 saveToDisk 改进
function saveToDisk(notes: Note[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (reloading) return;
    const json = JSON.stringify(notes);
    if (json === lastSavedJson) return;
    lastSavedJson = json;
    window.electronAPI?.saveNotes(json);
  }, 500); // 从 300ms 增加到 500ms
}
```

### 5.4 画布虚拟化

**目标**：仅渲染视口内的画布元素。

```typescript
// CanvasBoard.tsx 中增加视口裁剪
function getVisibleItems(
  items: CanvasItem[],
  camera: Camera,
  viewportRect: DOMRect
): CanvasItem[] {
  const margin = 200; // 缓冲区
  return items.filter((item) => {
    const screenX = item.x * camera.scale + camera.x;
    const screenY = item.y * camera.scale + camera.y;
    const screenW = item.width * camera.scale;
    const screenH = (item.height || 200) * camera.scale;
    return (
      screenX + screenW > -margin &&
      screenX < viewportRect.width + margin &&
      screenY + screenH > -margin &&
      screenY < viewportRect.height + margin
    );
  });
}
```

### 5.5 编辑器防抖

```typescript
// Editor.tsx 中的 onChange 处理
const handleChange = useMemo(() => {
  let debounceTimer: NodeJS.Timeout;
  return (value: string) => {
    // 立即更新内存状态（用于侧边栏标题等）
    updateContent(id, value);
    // 延迟保存到磁盘
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // 触发磁盘保存
    }, 500);
  };
}, [id, updateContent]);
```

---

## 六、Phase 4：代码质量 (P2)

### 6.1 TypeScript 严格化

**改进清单**：

| 项目 | 当前 | 目标 |
|------|------|------|
| `tsconfig.json` strict | `true` | `true` + `noUncheckedIndexedAccess` |
| `electron.d.ts` | 手动 86 行 | 删除，用 `electron` 包类型 |
| `any` 使用 | ~15 处 | 减少到 0 |
| 类型断言 `as` | ~8 处 | 改用类型守卫 |

### 6.2 核心类型集中管理

```typescript
// src/shared/types.ts — 从 StudyWorkbench.tsx 提取
export type { Subject, TaskBucket, Mastery, BookSort };
export type { Task, FocusRecord, Book, Question, QuestionBook, Workspace };

// src/shared/canvas-types.ts — 从 noteStore.ts 提取
export type { CanvasItemType, CanvasItem, CanvasLink, CanvasOutlineItem, NoteVersion, Note };
```

### 6.3 CSS 架构优化

```
src/renderer/styles/
├── index.css              → Tailwind 指令 + 全局变量
├── workbench.css          → 学习工作台样式
├── canvas.css             → 无限画布样式
├── editor.css             → 编辑器/预览样式
├── sidebar.css            → 侧边栏样式
└── components.css         → 通用组件样式（按钮、面板等）
```

### 6.4 i18n 扩展

当前 `i18n.ts` 仅覆盖 ~90 个 UI 字符串，工作台内部有 ~200 个硬编码中文。

**补充覆盖**：
- 工作台导航："总览"、"规划"、"专注"、"书架"、"题册"、"笔记"、"画布"、"设置"
- 书架操作："导入本地文件"、"搜索书名"、"阅读进度" 等
- 题册操作："导入题册 Markdown"、"手动添加错题"、"刷新整理文件" 等
- 提示文案："工作台内容已超过 30 条" 等

---

## 七、Phase 5：功能增强 (P3)

### 7.1 智能搜索

```typescript
// 引入 minisearch
import MiniSearch from 'minisearch';

const searchIndex = new MiniSearch<Note>({
  fields: ['title', 'content', 'tags'],
  storeFields: ['title', 'content'],
  searchOptions: {
    boost: { title: 2, tags: 1.5 },
    prefix: true,
    fuzzy: 0.2,
  },
});

// 启动时构建索引
function buildSearchIndex(notes: Note[]) {
  searchIndex.removeAll();
  searchIndex.addAll(notes.filter(n => !n.isDeleted));
}

// 搜索
function searchNotes(query: string): Note[] {
  return searchIndex.search(query).map(result => notes.find(n => n.id === result.id)!);
}
```

### 7.2 版本历史增强

- 引入 `diff` 库展示版本差异
- 支持 diff 视图（左右对比 / 行级高亮）
- 版本恢复前支持预览
- 按内容大小动态调整版本间隔

### 7.3 画布多选与撤销

```typescript
// 多选
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
// Shift+点击追加选中
// 框选（拖拽空白区域 + Shift）

// 撤销重做
interface CanvasHistory {
  past: { items: CanvasItem[]; links: CanvasLink[] }[];
  future: { items: CanvasItem[]; links: CanvasLink[] }[];
}
```

### 7.4 零依赖 PDF 导出

```typescript
// 使用 Electron 内置的 printToPDF
ipcMain.handle('export-pdf-native', async (_e, html: string) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return { success: false };
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const pdfBuffer = await pdfWin.webContents.printToPDF({
    pageSize: 'A4',
    margins: { top: 0.5, bottom: 0.5, left: 0.75, right: 0.75 },
    printBackground: true,
  });
  pdfWin.close();
  // 保存到用户选择的路径
  return { success: true, buffer: pdfBuffer.toString('base64') };
});
```

### 7.5 自动备份

```typescript
// 设置面板增加自动备份开关和频率
interface BackupSettings {
  autoBackup: boolean;
  backupInterval: 'daily' | 'weekly' | 'monthly';
  backupPath: string;
  maxBackups: number;
}

// 主进程定时任务
function scheduleAutoBackup(settings: BackupSettings) {
  if (!settings.autoBackup) return;
  const interval = { daily: 86400000, weekly: 604800000, monthly: 2592000000 };
  setInterval(() => {
    createBackupFile(settings.backupPath, settings.maxBackups);
  }, interval[settings.backupInterval]);
}
```

---

## 八、Phase 6：工程化 (P4)

### 8.1 测试体系

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

**测试覆盖优先级**：

| 优先级 | 模块 | 测试类型 |
|--------|------|---------|
| 1 | `markdown.ts` | 单元测试 — LaTeX 解析、Wiki 链接、任务提取 |
| 2 | `noteStore.ts` | 单元测试 — CRUD、版本历史、排序 |
| 3 | `workspaceStorage.ts` | 集成测试 — 迁移、备份、校验 |
| 4 | `Sidebar.tsx` | 组件测试 — 搜索、筛选、新建 |
| 5 | E2E 关键流程 | Playwright — 启动、新建便签、保存、导出 |

### 8.2 CI/CD 增强

```yaml
# .github/workflows/ci.yml 增强
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx tsc --noEmit          # 类型检查
      - run: npx vitest run            # 单元测试
      - run: npm run build             # 构建验证
      - run: npx electron-builder --win --publish never  # 打包验证
```

### 8.3 自动更新

```typescript
// 引入 electron-updater
import { autoUpdater } from 'electron-updater';

// 在 app.whenReady 中
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.checkForUpdatesAndNotify();
```

---

## 九、实施路线图

### 总工期估算：3-4 周

```
Week 1: Phase 1 (安全加固) + Phase 2 准备
├── Day 1-2: XSS 消毒 + CSP + 路径校验
├── Day 3-5: 主进程拆分
└── Day 6-7: StudyWorkbench 类型提取 + Hook 拆分

Week 2: Phase 2 (架构拆分) + Phase 3 (性能)
├── Day 1-3: StudyWorkbench 子视图拆分
├── Day 4-5: 附件存储重构
└── Day 6-7: 增量保存 + 编辑器防抖

Week 3: Phase 3 (性能) + Phase 4 (质量)
├── Day 1-2: Markdown Web Worker
├── Day 3-4: 画布虚拟化
├── Day 5-6: TypeScript 严格化 + CSS 架构
└── Day 7: i18n 扩展

Week 4: Phase 5 (功能) + Phase 6 (工程化)
├── Day 1-2: 智能搜索 + 零依赖 PDF
├── Day 3-4: 测试体系搭建
├── Day 5-6: CI/CD 增强 + 打包优化
└── Day 7: 回归测试 + v3.1.0 发布
```

### 版本发布计划

| 版本 | 内容 | 发布时间 |
|------|------|---------|
| v3.0.5 | Phase 1 — 安全加固 | Week 1 结束 |
| v3.1.0 | Phase 2 — 架构拆分 | Week 2 结束 |
| v3.2.0 | Phase 3 — 性能优化 | Week 3 结束 |
| v3.3.0 | Phase 4+5 — 质量 + 功能 | Week 4 结束 |

---

## 附录 A：依赖变更

| 操作 | 包名 | 用途 |
|------|------|------|
| 新增 | `dompurify` | XSS 消毒 |
| 新增 | `@types/dompurify` | 类型声明 |
| 新增 | `minisearch` | 全文搜索 |
| 新增 | `diff` | 版本差异对比 |
| 新增 | `vitest` | 单元测试框架 |
| 新增 | `@testing-library/react` | 组件测试 |
| 新增 | `electron-updater` | 自动更新 |
| 可选移除 | `html-to-docx` | 被 Pandoc 导出替代 |

## 附录 B：文件变更清单

| 阶段 | 新增文件 | 修改文件 | 删除文件 |
|------|---------|---------|---------|
| Phase 1 | 0 | `markdown.ts`, `index.ts(main)` | 0 |
| Phase 2 | ~15 (ipc/*, windows/*, hooks/*, types/*) | `index.ts(main)`, `StudyWorkbench.tsx`, `preload.ts` | `electron.d.ts` |
| Phase 3 | ~3 (workers/*, shared/ipc-types.ts) | `noteStore.ts`, `CanvasBoard.tsx`, `attachmentStore.ts` | 0 |
| Phase 4 | ~5 (styles/*.css) | `tsconfig.json`, `i18n.ts`, 多个组件 | 0 |
| Phase 5 | ~3 | `Sidebar.tsx`, `noteStore.ts`, `main/index.ts` | 0 |
| Phase 6 | ~10 (tests/*) | `ci.yml`, `package.json` | 0 |

---

*此优化方案基于对暮雨笺 v3.0.4 全部源码的逐行审查。方案优先考虑安全和架构基础，其次是性能和可维护性，最后是功能扩展。每个 Phase 可独立发布，不会破坏现有用户体验。*
