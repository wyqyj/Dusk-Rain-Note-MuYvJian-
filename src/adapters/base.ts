/**
 * adapters/base.ts — 安全降级基座适配器
 *
 * 所有端口都必须可用（永不 undefined，永不在 ui 层抛错）。
 * 未实现的端口方法返回与桌面语义一致的保守降级值，并 console.warn 标记，
 * 保证"适配器未装配"时应用仍可启动与演示，且缺口可被日志发现。
 */

import type {
  CancelableResult, IEventBus, IExporter, IFilePicker, IKVStore, INoteRepo,
  INotifier, ITimerRepo, IWindowOps, IWorkspaceRepo, OpResult, PlatformBridge,
  WorkspaceSkillResult,
} from '../ports';

function warn(method: string): void {
  console.warn(`[adapter] 未接入的方法被调用: ${method}（返回降级值）`);
}

export const UNAVAILABLE: OpResult = { success: false, error: '当前平台不支持该操作' };

export class BaseNoteRepo implements INoteRepo {
  platform = 'base';
  async getNotes(): Promise<string> { warn('notes.getNotes'); return '[]'; }
  async saveNotes(): Promise<OpResult> { warn('notes.saveNotes'); return { success: true }; }
  async getAttachments(): Promise<string> { warn('notes.getAttachments'); return '[]'; }
  async saveAttachments(): Promise<OpResult> { warn('notes.saveAttachments'); return { success: true }; }
  async getQuickNote(): Promise<string> { return ''; }
  saveQuickNote(): void { /* 丢弃 */ }
  async createQuickNote(): Promise<{ success: boolean; noteId?: string; error?: string }> { return { success: false, error: '不支持' }; }
  async updateQuickNoteContent(): Promise<OpResult> { return UNAVAILABLE; }
  async updateQuickNote(): Promise<OpResult> { return UNAVAILABLE; }
}

export class BaseTimerRepo implements ITimerRepo {
  async saveTimerRecord(): Promise<OpResult> { return UNAVAILABLE; }
  async getTimerRecords(): Promise<string> { return '[]'; }
  async saveActiveSession(): Promise<OpResult> { return UNAVAILABLE; }
  async loadActiveSession(): Promise<unknown> { return null; }
}

export class BaseKVStore implements IKVStore {
  async getSettings(): Promise<Record<string, unknown>> { return {}; }
  saveSettings(): void { /* 丢弃 */ }
  updateTheme(): void { /* 由 ui 层同步 document */ }
}

export class BaseWorkspaceRepo implements IWorkspaceRepo {
  async getWorkspaceState(): Promise<string> { return ''; }
  async saveWorkspaceState(_stateJson?: string): Promise<OpResult> { return { success: true }; }
  async resetWorkspace(): Promise<OpResult & { files?: number; root?: string; initialized?: boolean }> { warn('workspace.resetWorkspace'); return UNAVAILABLE; }
  async getWorkspaceRoot(): Promise<string> { return '(未配置)'; }
  async chooseWorkspaceRoot(): Promise<CancelableResult> { return { canceled: true }; }
  async migrateWorkspace(): Promise<OpResult & { source?: string; destination?: string; files?: number }> { return UNAVAILABLE; }
  async backupWorkspace(): Promise<{ success: boolean; path?: string; error?: string }> { warn('workspace.backupWorkspace'); return UNAVAILABLE; }
  async restoreWorkspace(): Promise<{ success: boolean; error?: string; files?: number }> { return UNAVAILABLE; }
  async chooseQuestionBook(): Promise<{ canceled?: boolean; folder?: string; originalFolder?: string; content?: string }> { return { canceled: true }; }
  async readQuestionBook(): Promise<{ success: boolean; folder?: string; content?: string; error?: string }> { return UNAVAILABLE; }
  async chooseBook(): Promise<{ canceled?: boolean; path?: string; originalPath?: string; name?: string; coverPath?: string; coverError?: string }> { return { canceled: true }; }
  async generateBookCover(): Promise<{ success: boolean; coverPath?: string; error?: string }> { return UNAVAILABLE; }
  async openWorkspacePath(): Promise<OpResult & { path?: string }> { return UNAVAILABLE; }
  async openWorkspaceExamples(): Promise<OpResult & { path?: string }> { return UNAVAILABLE; }
  async getQuestionBookSkill(): Promise<WorkspaceSkillResult> { return { success: false, error: '不支持' }; }
  async getPlanImportSkill(): Promise<WorkspaceSkillResult> { return { success: false, error: '不支持' }; }
}

export class BaseExporter implements IExporter {
  async getDataPath(): Promise<string> { return ''; }
  async exportData(): Promise<string> { return ''; }
  async importData(): Promise<OpResult> { return UNAVAILABLE; }
  async exportWord(): Promise<{ success: boolean; path?: string; error?: string }> { warn('exporter.exportWord'); return UNAVAILABLE; }
  async exportPdf(): Promise<{ success: boolean; path?: string; error?: string }> { warn('exporter.exportPdf'); return UNAVAILABLE; }
  async pandocCompile(): Promise<{ success: boolean; html?: string; error?: string }> { return { success: false, error: '移动端不支持 pandoc' }; }
  async exportMarkdown(): Promise<{ success: boolean; path?: string; error?: string }> { warn('exporter.exportMarkdown'); return UNAVAILABLE; }
  async exportHtml(): Promise<{ success: boolean; path?: string; error?: string }> { warn('exporter.exportHtml'); return UNAVAILABLE; }
}

export class BaseEventBus implements IEventBus {
  onReloadNotes(): void {}
  onSaveBeforeClose(): void {}
  onNewNote(): void {}
  onExportData(): void {}
  onImportData(): void {}
  onSelectNote(): void {}
  selectNote(): void {}
  reloadNotesFromDisk(): void {}
}

export class BaseNotifier implements INotifier {
  async notify(): Promise<boolean> { return false; }
}

export class BaseWindowOps implements IWindowOps {
  winMinimize(): void {}
  winMaximize(): void {}
  winClose(): void {}
  async winIsMaximized(): Promise<boolean> { return false; }
  toggleQuickNote(): void {}
  closeQuickNote(): void {}
  minimizeQuickNote(): void {}
  toggleTodayPlanWindow(): void {}
  closeTodayPlanWindow(): void {}
  minimizeTodayPlanWindow(): void {}
  toggleTimerStatsWindow(): void {}
  closeTimerStatsWindow(): void {}
  minimizeTimerStatsWindow(): void {}
  setOpacity(_opacity: number): void {}
  async getOpacity(): Promise<number> { return 1; }
}

export class BaseFilePicker implements IFilePicker {
  async pickImage(): Promise<null> { return null; }
  async pickAnyFile(): Promise<null> { return null; }
  async pickDirectory(): Promise<null> { return null; }
}

/** 全部端口取默认降级实现，供子类按需覆写。 */
export class BaseBridge implements PlatformBridge {
  platform: string = 'base';
  notes: INoteRepo = new BaseNoteRepo();
  timers: ITimerRepo = new BaseTimerRepo();
  kv: IKVStore = new BaseKVStore();
  workspace: IWorkspaceRepo = new BaseWorkspaceRepo();
  exporter: IExporter = new BaseExporter();
  events: IEventBus = new BaseEventBus();
  notifier: INotifier = new BaseNotifier();
  window: IWindowOps = new BaseWindowOps();
  picker: IFilePicker = new BaseFilePicker();
}