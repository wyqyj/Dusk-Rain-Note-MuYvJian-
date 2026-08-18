/**
 * ports/index.ts — 能力接口层（六边形架构端口）
 *
 * ██ 设计原则 ██
 * 1. 纯 TypeScript 契约，零平台依赖（不 import Capacitor/Electron/DOM 类型）。
 * 2. 方法签名与上游 Electron preload IPC 契约（src/main/preload.ts + renderer/vite-env.d.ts）
 *    逐一对应，保证 ui 层 DI 化改造是"机械归类"，不改变任何业务语义。
 * 3. 九个端口按能力域内聚；任一端口可独立替换实现（capacitor / web / memory / electron）。
 * 4. 所有异步方法都返回 Promise，降级实现返回与桌面语义一致的失败/取消对象，
 *    调用方（ui/core）无需感知平台差异。
 */

// ────────────────────────────────────────────────────────────────────────────
// 通用结果类型（与上游 IPC 返回保持一致）
// ────────────────────────────────────────────────────────────────────────────

export interface OpResult { success: boolean; error?: string }
export interface OpResultWithFiles extends OpResult { files?: number; root?: string }
export interface CancelableResult { canceled?: boolean; path?: string }

// ────────────────────────────────────────────────────────────────────────────
// 1. INoteRepo — 便签 / 附件 / 快速笔记 数据存储
//    （对应桌面 data 目录 JSON 文件：notes.json / attachments.json）
// ────────────────────────────────────────────────────────────────────────────

export interface INoteRepo {
  getNotes(): Promise<string>;
  saveNotes(notesJson: string): Promise<OpResult>;
  getAttachments(): Promise<string>;
  saveAttachments(attachmentsJson: string): Promise<OpResult>;
  getQuickNote(): Promise<string>;
  saveQuickNote(content: string): void;
  createQuickNote(noteJson: string): Promise<{ success: boolean; noteId?: string; error?: string }>;
  updateQuickNoteContent(noteId: string, content: string): Promise<OpResult>;
  updateQuickNote(noteId: string, updatesJson: string): Promise<OpResult>;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. ITimerRepo — 任务计时数据
//    （对应 task-timer-records.json 与活跃会话）
// ────────────────────────────────────────────────────────────────────────────

export interface ITimerRepo {
  saveTimerRecord(record: unknown): Promise<OpResult>;
  getTimerRecords(): Promise<string>;
  saveActiveSession(session: unknown): Promise<OpResult>;
  loadActiveSession(): Promise<unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. IKVStore — 键值偏好存储
//    （对应桌面 electron-store：settings / quickNote 草稿）
// ────────────────────────────────────────────────────────────────────────────

export interface IKVStore {
  getSettings(): Promise<Record<string, unknown>>;
  saveSettings(settings: Record<string, unknown>): void;
  updateTheme(theme: string): void;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. IWorkspaceRepo — 学习工作台（状态 / 文件 / 题册 / 书籍 / 备份恢复）
// ────────────────────────────────────────────────────────────────────────────

export interface WorkspaceSkillResult { success: boolean; directory?: string; skillPath?: string; promptPath?: string; prompt?: string; error?: string }

export interface IWorkspaceRepo {
  getWorkspaceState(): Promise<string>;
  saveWorkspaceState(stateJson: string): Promise<OpResult>;
  resetWorkspace(): Promise<OpResultWithFiles & { initialized?: boolean }>;
  getWorkspaceRoot(): Promise<string>;
  chooseWorkspaceRoot(): Promise<CancelableResult>;
  migrateWorkspace(destination: string): Promise<OpResultWithFiles & { source?: string; destination?: string }>;
  backupWorkspace(): Promise<{ success: boolean; path?: string; error?: string }>;
  restoreWorkspace(): Promise<{ success: boolean; error?: string; files?: number }>;
  chooseQuestionBook(): Promise<{ canceled?: boolean; folder?: string; originalFolder?: string; content?: string }>;
  readQuestionBook(folder: string): Promise<{ success: boolean; folder?: string; content?: string; error?: string }>;
  chooseBook(): Promise<{ canceled?: boolean; path?: string; originalPath?: string; name?: string; coverPath?: string; coverError?: string }>;
  generateBookCover(sourcePath: string): Promise<{ success: boolean; coverPath?: string; error?: string }>;
  openWorkspacePath(target: string): Promise<OpResult & { path?: string }>;
  openWorkspaceExamples(): Promise<OpResult & { path?: string }>;
  getQuestionBookSkill(): Promise<WorkspaceSkillResult>;
  getPlanImportSkill(): Promise<WorkspaceSkillResult>;
}

// ────────────────────────────────────────────────────────────────────────────
// 5. IExporter — 数据导入导出 / 文档导出
//    （Word/PDF 在移动端为降级链路：jsPDF/docx 或格式替代）
// ────────────────────────────────────────────────────────────────────────────

export interface IExporter {
  getDataPath(): Promise<string>;
  exportData(): Promise<string>;
  importData(dataJson: string): Promise<OpResult>;
  exportWord(title: string, content: string): Promise<{ success: boolean; path?: string; error?: string }>;
  exportPdf(title: string, content: string): Promise<{ success: boolean; path?: string; error?: string }>;
  pandocCompile(source: string, fromFormat?: string): Promise<{ success: boolean; html?: string; error?: string }>;
  exportMarkdown(title: string, content: string): Promise<{ success: boolean; path?: string; error?: string }>;
  exportHtml(title: string, html: string): Promise<{ success: boolean; path?: string; error?: string }>;
}

// ────────────────────────────────────────────────────────────────────────────
// 6. IEventBus — 跨窗口/模块事件（桌面多窗口语义在移动端收敛为站内事件）
// ────────────────────────────────────────────────────────────────────────────

export interface IEventBus {
  onReloadNotes(callback: () => void): void;
  onSaveBeforeClose(callback: () => void): void;
  onNewNote(callback: () => void): void;
  onExportData(callback: () => void): void;
  onImportData(callback: () => void): void;
  onSelectNote(callback: (noteId: string) => void): void;
  selectNote(noteId: string): void;
  reloadNotesFromDisk(): void;
}

// ────────────────────────────────────────────────────────────────────────────
// 7. INotifier — 系统通知
// ────────────────────────────────────────────────────────────────────────────

export interface INotifier {
  notify(title: string, body: string): Promise<boolean>;
}

// ────────────────────────────────────────────────────────────────────────────
// 8. IWindowOps — 窗口/覆盖层控制（移动端单窗口：多数为 no-op 或覆盖层切换）
// ────────────────────────────────────────────────────────────────────────────

export interface IWindowOps {
  winMinimize(): void;
  winMaximize(): void;
  winClose(): void;
  winIsMaximized(): Promise<boolean>;
  toggleQuickNote(): void;
  closeQuickNote(): void;
  minimizeQuickNote(): void;
  toggleTodayPlanWindow(): void;
  closeTodayPlanWindow(): void;
  minimizeTodayPlanWindow(): void;
  toggleTimerStatsWindow(): void;
  closeTimerStatsWindow(): void;
  minimizeTimerStatsWindow(): void;
  setOpacity(opacity: number): void;
  getOpacity(): Promise<number>;
}

// ────────────────────────────────────────────────────────────────────────────
// 9. IFilePicker — 底层文件选择能力（内容提供方的 URI 语义；领域拷贝逻辑在 adapter）
// ────────────────────────────────────────────────────────────────────────────

export interface PickedFile { uri: string; name: string; mimeType?: string; data?: string }
export interface PickedDirectory { uri: string; name: string }

export interface IFilePicker {
  pickImage(): Promise<PickedFile | null>;
  pickAnyFile(): Promise<PickedFile | null>;
  pickDirectory(): Promise<PickedDirectory | null>;
}

// ────────────────────────────────────────────────────────────────────────────
// PlatformBridge — 组合全部端口，向 ui 层暴露的唯一依赖面
// ────────────────────────────────────────────────────────────────────────────

export interface PlatformBridge {
  notes: INoteRepo;
  timers: ITimerRepo;
  kv: IKVStore;
  workspace: IWorkspaceRepo;
  exporter: IExporter;
  events: IEventBus;
  notifier: INotifier;
  window: IWindowOps;
  picker: IFilePicker;
  /** 运行平台标识（'capacitor' | 'web' | 'electron' | 'memory'） */
  platform: string;
}

export type PlatformName = 'capacitor' | 'web' | 'electron' | 'memory';