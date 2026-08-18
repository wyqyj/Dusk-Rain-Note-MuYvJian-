/**
 * adapters/web/index.ts — Web（浏览器/LocalStorage）适配器
 *
 * 用途：桌面浏览器调试、无 Capacitor 环境的降级运行、快速预览。
 * 存储键与上游 localStorage 回退键保持一致（lingxi-notes 等），可无缝承接旧数据。
 */

import type {
  CancelableResult, OpResult, PickedDirectory, PickedFile, PlatformBridge,
} from '../../ports';
import { BaseBridge, UNAVAILABLE } from '../base';

const KEY_NOTES = 'lingxi-notes';
const KEY_ATTACHMENTS = 'lingxi-attachments';
const KEY_SETTINGS = 'lingxi-settings';
const KEY_QUICK_NOTE = 'lingxi-quick-note';
const KEY_WORKSPACE = 'lingxi-workspace-state';
const KEY_TIMER_RECORDS = 'lingxi-timer-records';
const KEY_ACTIVE_SESSION = 'lingxi-active-session';

function read(key: string): string {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 容量满时静默 */ }
}

class WebNoteRepo {
  async getNotes(): Promise<string> { const v = read(KEY_NOTES); return v || '[]'; }
  async saveNotes(json: string): Promise<OpResult> { write(KEY_NOTES, json); return { success: true }; }
  async getAttachments(): Promise<string> { const v = read(KEY_ATTACHMENTS); return v || '[]'; }
  async saveAttachments(json: string): Promise<OpResult> { write(KEY_ATTACHMENTS, json); return { success: true }; }
  async getQuickNote(): Promise<string> { return read(KEY_QUICK_NOTE); }
  saveQuickNote(content: string): void { write(KEY_QUICK_NOTE, content); }
  async createQuickNote(noteJson: string): Promise<{ success: boolean; noteId?: string; error?: string }> {
    try {
      const parsed = JSON.parse(noteJson) as { id?: string };
      const id = parsed?.id || `note-${Date.now().toString(36)}`;
      const notes = JSON.parse(read(KEY_NOTES) || '[]') as unknown[];
      notes.unshift({ ...parsed, id });
      write(KEY_NOTES, JSON.stringify(notes));
      return { success: true, noteId: id };
    } catch (error: any) {
      return { success: false, error: error?.message || 'createQuickNote 失败' };
    }
  }
  async updateQuickNoteContent(noteId: string, content: string): Promise<OpResult> {
    try {
      const notes = JSON.parse(read(KEY_NOTES) || '[]') as any[];
      write(KEY_NOTES, JSON.stringify(notes.map((n) => (n.id === noteId ? { ...n, content, updatedAt: Date.now() } : n))));
      return { success: true };
    } catch { return { success: false, error: '更新失败' }; }
  }
  async updateQuickNote(noteId: string, updatesJson: string): Promise<OpResult> {
    try {
      const updates = JSON.parse(updatesJson) as Record<string, unknown>;
      const notes = JSON.parse(read(KEY_NOTES) || '[]') as any[];
      write(KEY_NOTES, JSON.stringify(notes.map((n) => (n.id === noteId ? { ...n, ...updates, updatedAt: Date.now() } : n))));
      return { success: true };
    } catch { return { success: false, error: '更新失败' }; }
  }
}

class WebTimerRepo {
  async saveTimerRecord(record: unknown): Promise<OpResult> {
    try {
      const records = JSON.parse(read(KEY_TIMER_RECORDS) || '[]') as unknown[];
      records.push(record);
      write(KEY_TIMER_RECORDS, JSON.stringify(records));
      return { success: true };
    } catch { return { success: false, error: '记录失败' }; }
  }
  async getTimerRecords(): Promise<string> { const v = read(KEY_TIMER_RECORDS); return v || '[]'; }
  async saveActiveSession(session: unknown): Promise<OpResult> {
    try { write(KEY_ACTIVE_SESSION, session ? JSON.stringify(session) : ''); return { success: true }; } catch { return { success: false, error: '保存失败' }; }
  }
  async loadActiveSession(): Promise<unknown> {
    const v = read(KEY_ACTIVE_SESSION); return v ? JSON.parse(v) : null;
  }
}

class WebKVStore {
  async getSettings(): Promise<Record<string, unknown>> {
    try { return JSON.parse(read(KEY_SETTINGS) || '{}'); } catch { return {}; }
  }
  saveSettings(settings: Record<string, unknown>): void { write(KEY_SETTINGS, JSON.stringify(settings)); }
  updateTheme(): void { /* ui 层自行同步 document */ }
}

class WebWorkspaceRepo {
  async getWorkspaceState(): Promise<string> { return read(KEY_WORKSPACE); }
  async saveWorkspaceState(stateJson: string): Promise<OpResult> { write(KEY_WORKSPACE, stateJson); return { success: true }; }
  async resetWorkspace(): Promise<OpResult & { files?: number; initialized?: boolean }> {
    write(KEY_WORKSPACE, ''); return { success: true, files: 0, initialized: false };
  }
  async getWorkspaceRoot(): Promise<string> { return read('lingxi-workspace-root') || '(浏览器本地存储)'; }
  async chooseWorkspaceRoot(): Promise<CancelableResult> { return { path: '(浏览器本地存储)' }; }
  async migrateWorkspace(): Promise<OpResult & { source?: string; destination?: string; files?: number }> { return { success: true, files: 0 }; }
  async backupWorkspace(): Promise<{ success: boolean; path?: string; error?: string }> { return UNAVAILABLE; }
  async restoreWorkspace(): Promise<{ success: boolean; error?: string; files?: number }> { return UNAVAILABLE; }
  async chooseQuestionBook(): Promise<{ canceled?: boolean; folder?: string; content?: string }> { return { canceled: true }; }
  async readQuestionBook(): Promise<{ success: boolean; content?: string; error?: string }> { return UNAVAILABLE; }
  async chooseBook(): Promise<{ canceled?: boolean }> { return { canceled: true }; }
  async generateBookCover(): Promise<{ success: boolean; coverPath?: string; error?: string }> { return UNAVAILABLE; }
  async openWorkspacePath(): Promise<OpResult & { path?: string }> { return UNAVAILABLE; }
  async openWorkspaceExamples(): Promise<OpResult & { path?: string }> { return UNAVAILABLE; }
  async getQuestionBookSkill(): Promise<{ success: boolean; prompt?: string; error?: string }> { return { success: true, prompt: '' }; }
  async getPlanImportSkill(): Promise<{ success: boolean; prompt?: string; error?: string }> { return { success: true, prompt: '' }; }
}

/** 触发浏览器下载（导出能力在 web 平台的最小实现）。 */
function downloadText(filename: string, text: string, mimeType: string): { success: boolean; path?: string; error?: string } {
  try {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { success: true, path: filename };
  } catch (error: any) {
    return { success: false, error: error?.message || '导出失败' };
  }
}

class WebExporter {
  async getDataPath(): Promise<string> { return '(浏览器本地存储)'; }
  async exportData(): Promise<string> {
    return JSON.stringify({ notes: read(KEY_NOTES), attachments: read(KEY_ATTACHMENTS), settings: read(KEY_SETTINGS) });
  }
  async importData(dataJson: string): Promise<OpResult> {
    try {
      const data = JSON.parse(dataJson) as { notes?: string; attachments?: string; settings?: string };
      if (data.notes) write(KEY_NOTES, data.notes);
      if (data.attachments) write(KEY_ATTACHMENTS, data.attachments);
      if (data.settings) write(KEY_SETTINGS, data.settings);
      return { success: true };
    } catch (error: any) { return { success: false, error: error?.message || '导入失败' }; }
  }
  async exportWord(title: string, content: string): Promise<{ success: boolean; path?: string; error?: string }> {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title></head><body><pre>${content}</pre></body></html>`;
    return downloadText(`${title}.doc`, html, 'application/msword');
  }
  async exportPdf(title: string, content: string): Promise<{ success: boolean; path?: string; error?: string }> {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title></head><body><pre>${content}</pre></body></html>`;
    return downloadText(`${title}.html`, html, 'text/html');
  }
  async pandocCompile(): Promise<{ success: boolean; html?: string; error?: string }> {
    return { success: false, error: 'Web 平台不支持 pandoc 编译' };
  }
  async exportMarkdown(title: string, content: string): Promise<{ success: boolean; path?: string; error?: string }> {
    return downloadText(`${title}.md`, content, 'text/markdown');
  }
  async exportHtml(title: string, html: string): Promise<{ success: boolean; path?: string; error?: string }> {
    return downloadText(title, html, 'text/html');
  }
}

class WebEventBus {
  private target = new EventTarget();
  private static EVENT = 'muyujian:event';
  onReloadNotes(callback: () => void): void { this.target.addEventListener('reload-notes', callback); }
  onSaveBeforeClose(callback: () => void): void { this.target.addEventListener('save-before-close', callback); }
  onNewNote(callback: () => void): void { this.target.addEventListener('new-note', callback); }
  onExportData(callback: () => void): void { this.target.addEventListener('export-data', callback); }
  onImportData(callback: () => void): void { this.target.addEventListener('import-data', callback); }
  onSelectNote(callback: (noteId: string) => void): void {
    this.target.addEventListener('select-note', ((e: CustomEvent<string>) => callback(e.detail)) as EventListener);
  }
  selectNote(noteId: string): void { this.target.dispatchEvent(new CustomEvent('select-note', { detail: noteId })); }
  reloadNotesFromDisk(): void { this.target.dispatchEvent(new Event('reload-notes')); }
}

class WebNotifier {
  async notify(title: string, body: string): Promise<boolean> {
    try {
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'granted') { new Notification(title, { body }); return true; }
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') { new Notification(title, { body }); return true; }
      }
      return false;
    } catch { return false; }
  }
}

class WebFilePicker {
  private pick(multiple: boolean, accept: string): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      if (multiple) input.multiple = true;
      input.onchange = () => resolve(Array.from(input.files || []));
      input.oncancel = () => resolve([]);
      input.click();
    });
  }
  private async fileToPicked(file: File): Promise<PickedFile> {
    return { uri: file.name, name: file.name, mimeType: file.type, data: await file.arrayBuffer().then((b) => new TextDecoder().decode(b)) };
  }
  async pickImage(): Promise<PickedFile | null> {
    const files = await this.pick(false, 'image/*'); return files[0] ? this.fileToPicked(files[0]) : null;
  }
  async pickAnyFile(): Promise<PickedFile | null> {
    const files = await this.pick(false, ''); return files[0] ? this.fileToPicked(files[0]) : null;
  }
  async pickDirectory(): Promise<PickedDirectory | null> { return null; }
}

export class WebBridge extends BaseBridge {
  override platform: PlatformBridge['platform'] = 'web';
  override notes = new WebNoteRepo() as unknown as PlatformBridge['notes'];
  override timers = new WebTimerRepo() as unknown as PlatformBridge['timers'];
  override kv = new WebKVStore() as unknown as PlatformBridge['kv'];
  override workspace = new WebWorkspaceRepo() as unknown as PlatformBridge['workspace'];
  override exporter = new WebExporter() as unknown as PlatformBridge['exporter'];
  override events = new WebEventBus() as unknown as PlatformBridge['events'];
  override notifier = new WebNotifier() as unknown as PlatformBridge['notifier'];
  override picker = new WebFilePicker() as unknown as PlatformBridge['picker'];
}

export function createWebBridge(): WebBridge {
  return new WebBridge();
}