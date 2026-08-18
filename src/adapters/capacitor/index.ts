/**
 * adapters/capacitor/index.ts — Capacitor（Android 原生桥）适配器
 *
 * 数据布局与桌面版同语义：
 *   DATA_DIR/notes.json · attachments.json · task-timer-records.json
 *   WORKSPACE_DIR/workspace.json · books/ · question-books/ · attachments/ · exports/ · backups/ · plans/
 * KV（settings/草稿/活跃会话）→ WebView localStorage 单通道（与 ui 加载侧一致）。
 * 桌面「综合备份」协议由 core/backup 负责打包/解包，此处仅负责落盘与分享。
 *
 * 文件选择说明：@capacitor/filesystem@8 无 pickFiles API；Android WebView 原生支持
 * `<input type="file">`（Capacitor 桥接 onShowFileChooser），故选择统一走 DOM input，
 * 读取后以 base64/UTF-8 写入应用沙箱。这是官方推荐且零额外依赖的方案。
 */

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';

import type {
  CancelableResult, OpResult, PickedDirectory, PickedFile, PlatformBridge,
  WorkspaceSkillResult,
} from '../../ports';
import {
  decodeBackupEntry, packBackup, safeRelativePath, unpackBackup, verifyBackupEntry,
} from '../../core/backup/compressor';
import { BaseBridge, BaseEventBus, BaseWindowOps, UNAVAILABLE } from '../base';

const DATA_DIR = 'lingxi-data';
const WORKSPACE_DIR = 'lingxi-workspace';
const FILE_NOTES = `${DATA_DIR}/notes.json`;
const FILE_ATTACHMENTS = `${DATA_DIR}/attachments.json`;
const FILE_TIMER_RECORDS = `${DATA_DIR}/task-timer-records.json`;
const KV_QUICK_NOTE = 'muyujian.quickNote';
const KV_ACTIVE_SESSION = 'muyujian.activeSession';
const KV_SETTINGS = 'lingxi-settings';
const WORKSPACE_SUBDIRS = ['books', 'question-books', 'attachments', 'exports', 'backups', 'plans'];

async function ensureDataDirs(): Promise<void> {
  for (const dir of [DATA_DIR, WORKSPACE_DIR, ...WORKSPACE_SUBDIRS.map((s) => `${WORKSPACE_DIR}/${s}`)]) {
    try { await Filesystem.mkdir({ path: dir, directory: Directory.Documents, recursive: true }); } catch { /* 已存在 */ }
  }
}

async function readJsonFile(path: string, fallback: string): Promise<string> {
  try {
    const result = await Filesystem.readFile({ path, directory: Directory.Documents, encoding: Encoding.UTF8 });
    return typeof result.data === 'string' ? result.data : fallback;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path: string, data: string): Promise<OpResult> {
  try {
    await ensureDataDirs();
    await Filesystem.writeFile({ path, data, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || '写入失败' };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** WebView 原生文件选择：<input type="file">（Capacitor Android 官方桥接）。 */
function pickFileViaInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

async function shareFile(filename: string, data: string, mimeType: string): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    await ensureDataDirs();
    const path = `${WORKSPACE_DIR}/exports/${filename}`;
    await Filesystem.writeFile({ path, data, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    const uri = (await Filesystem.getUri({ path, directory: Directory.Documents })).uri;
    const shareResult = await Share.share({ title: filename, url: uri, dialogTitle: filename });
    return shareResult.activityType ? { success: true, path: uri } : { success: false, error: '已取消分享' };
  } catch (error: any) {
    return { success: false, error: error?.message || '分享失败' };
  }
}

class CapacitorNoteRepo {
  async getNotes(): Promise<string> { return readJsonFile(FILE_NOTES, '[]'); }
  async saveNotes(json: string): Promise<OpResult> { return writeJsonFile(FILE_NOTES, json); }
  async getAttachments(): Promise<string> { return readJsonFile(FILE_ATTACHMENTS, '[]'); }
  async saveAttachments(json: string): Promise<OpResult> { return writeJsonFile(FILE_ATTACHMENTS, json); }
  async getQuickNote(): Promise<string> {
    const result = await Preferences.get({ key: KV_QUICK_NOTE }); return result.value ?? '';
  }
  saveQuickNote(content: string): void { void Preferences.set({ key: KV_QUICK_NOTE, value: content }); }
  async createQuickNote(noteJson: string): Promise<{ success: boolean; noteId?: string; error?: string }> {
    try {
      const parsed = JSON.parse(noteJson) as { id?: string };
      const id = parsed?.id || `note-${Date.now().toString(36)}`;
      const notes = JSON.parse(await this.getNotes()) as unknown[];
      notes.unshift({ ...parsed, id });
      const result = await writeJsonFile(FILE_NOTES, JSON.stringify(notes));
      return result.success ? { success: true, noteId: id } : result;
    } catch (error: any) {
      return { success: false, error: error?.message || 'createQuickNote 失败' };
    }
  }
  async updateQuickNoteContent(noteId: string, content: string): Promise<OpResult> {
    try {
      const notes = JSON.parse(await this.getNotes()) as any[];
      return writeJsonFile(FILE_NOTES, JSON.stringify(notes.map((n) => (n.id === noteId ? { ...n, content, updatedAt: Date.now() } : n))));
    } catch (error: any) { return { success: false, error: error?.message || '更新失败' }; }
  }
  async updateQuickNote(noteId: string, updatesJson: string): Promise<OpResult> {
    try {
      const updates = JSON.parse(updatesJson) as Record<string, unknown>;
      const notes = JSON.parse(await this.getNotes()) as any[];
      return writeJsonFile(FILE_NOTES, JSON.stringify(notes.map((n) => (n.id === noteId ? { ...n, ...updates, updatedAt: Date.now() } : n))));
    } catch (error: any) { return { success: false, error: error?.message || '更新失败' }; }
  }
}

class CapacitorTimerRepo {
  async saveTimerRecord(record: unknown): Promise<OpResult> {
    try {
      const records = JSON.parse(await readJsonFile(FILE_TIMER_RECORDS, '[]')) as unknown[];
      records.push(record);
      return writeJsonFile(FILE_TIMER_RECORDS, JSON.stringify(records, null, 2));
    } catch { return { success: false, error: '记录失败' }; }
  }
  async getTimerRecords(): Promise<string> { return readJsonFile(FILE_TIMER_RECORDS, '[]'); }
  async saveActiveSession(session: unknown): Promise<OpResult> {
    try {
      await Preferences.set({ key: KV_ACTIVE_SESSION, value: session ? JSON.stringify(session) : '' });
      return { success: true };
    } catch { return { success: false, error: '保存失败' }; }
  }
  async loadActiveSession(): Promise<unknown> {
    const result = await Preferences.get({ key: KV_ACTIVE_SESSION });
    return result.value ? JSON.parse(result.value) : null;
  }
}

class CapacitorKVStore {
  // 设置类 KV 统一走 WebView localStorage 单通道（与 ui/settingsStore 加载侧一致），
  // 避免 Preferences 与 localStorage 双通道不一致；大体积数据（壁纸等）亦适用。
  async getSettings(): Promise<Record<string, unknown>> {
    try { return JSON.parse(localStorage.getItem(KV_SETTINGS) || '{}'); } catch { return {}; }
  }
  saveSettings(settings: Record<string, unknown>): void {
    try { localStorage.setItem(KV_SETTINGS, JSON.stringify(settings)); } catch { /* 容量满时忽略 */ }
  }
  updateTheme(): void { /* ui 层同步 document.documentElement */ }
}

class CapacitorWorkspaceRepo {
  private get workspaceRoot(): string { return WORKSPACE_DIR; }
  async getWorkspaceState(): Promise<string> {
    const v = await readJsonFile(`${this.workspaceRoot}/workspace.json`, '');
    return v === '{}' ? '' : v;
  }
  async saveWorkspaceState(stateJson: string): Promise<OpResult> {
    if (!stateJson) return { success: true };
    return writeJsonFile(`${this.workspaceRoot}/workspace.json`, stateJson);
  }
  async resetWorkspace(): Promise<OpResult & { files?: number; root?: string; initialized?: boolean }> {
    try {
      await ensureDataDirs();
      for (const name of [FILE_NOTES, FILE_ATTACHMENTS, FILE_TIMER_RECORDS, `${this.workspaceRoot}/workspace.json`]) {
        try { await Filesystem.deleteFile({ path: name, directory: Directory.Documents }); } catch { /* 无 */ }
      }
      return { success: true, files: 0, root: `Documents/${this.workspaceRoot}`, initialized: false };
    } catch (error: any) { return { success: false, error: error?.message }; }
  }
  async getWorkspaceRoot(): Promise<string> { return `Documents/${this.workspaceRoot}`; }
  async chooseWorkspaceRoot(): Promise<CancelableResult> {
    // 移动端：数据目录固定为应用沙箱，无需用户选择
    return { path: `Documents/${this.workspaceRoot}` };
  }
  async migrateWorkspace(destination: string): Promise<OpResult & { source?: string; destination?: string; files?: number }> {
    // 移动端沙箱内不提供目录迁移（系统限制）；返回固定根以维持 ui 语义
    return { success: true, source: `Documents/${this.workspaceRoot}`, destination: destination || `Documents/${this.workspaceRoot}`, files: 0 };
  }
  async backupWorkspace(): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      await ensureDataDirs();
      const files: { path: string; data: Uint8Array }[] = [];
      const candidates: [string, string][] = [
        ['workspace.json', `${this.workspaceRoot}/workspace.json`],
        ['notes.json', FILE_NOTES],
        ['attachments.json', FILE_ATTACHMENTS],
        ['task-timer-records.json', FILE_TIMER_RECORDS],
      ];
      for (const [relative, path] of candidates) {
        const content = await readJsonFile(path, '');
        if (content) files.push({ path: relative, data: new TextEncoder().encode(content) });
      }
      const payload = await packBackup(files);
      const filename = `暮雨笺-${new Date().toISOString().slice(0, 10)}.muyujian-workspace`;
      const outPath = `${this.workspaceRoot}/backups/${filename}`;
      // 二进制文件：以 base64 写入（不带 encoding，插件自动解码）
      await Filesystem.writeFile({
        path: outPath,
        data: bytesToBase64(payload),
        directory: Directory.Documents,
        recursive: true,
      });
      const uri = (await Filesystem.getUri({ path: outPath, directory: Directory.Documents })).uri;
      try { await Share.share({ title: filename, url: uri, dialogTitle: filename }); } catch { /* 用户取消 */ }
      return { success: true, path: uri };
    } catch (error: any) {
      return { success: false, error: error?.message || '备份失败' };
    }
  }
  async restoreWorkspace(): Promise<{ success: boolean; error?: string; files?: number }> {
    try {
      const file = await pickFileViaInput('.muyujian-workspace,.bin');
      if (!file) return { success: false, error: 'cancelled' };
      const payload = unpackBackup(await readFileAsBytes(file));
      let restored = 0;
      await ensureDataDirs();
      for (const entry of payload.files) {
        if (!(await verifyBackupEntry(entry))) throw new Error(`备份校验失败：${entry.path}`);
        const relative = safeRelativePath(entry.path);
        const target = relative === 'notes.json' || relative === 'attachments.json' || relative === 'task-timer-records.json'
          ? `${DATA_DIR}/${relative}`
          : `${this.workspaceRoot}/${relative}`;
        await Filesystem.writeFile({ path: target, data: bytesToBase64(decodeBackupEntry(entry)), directory: Directory.Documents, recursive: true });
        restored += 1;
      }
      return { success: true, files: restored };
    } catch (error: any) {
      return { success: false, error: error?.message || '恢复失败' };
    }
  }
  async chooseQuestionBook(): Promise<{ canceled?: boolean; folder?: string; originalFolder?: string; content?: string }> {
    try {
      const file = await pickFileViaInput('.md,text/markdown');
      if (!file) return { canceled: true };
      const content = await readFileAsText(file);
      if (!content.trim()) return { canceled: true, folder: file.name };
      // 拷贝入托管目录（保持桌面语义：导入为独立快照）
      const folder = `${this.workspaceRoot}/question-books/${Date.now()}-${file.name.replace(/[<>:"/\\|?*]/g, '_')}`;
      await Filesystem.writeFile({ path: `${folder}/questions.md`, data: content, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
      return { folder, originalFolder: file.name, content };
    } catch (error: any) {
      return { canceled: true };
    }
  }
  async readQuestionBook(folder: string): Promise<{ success: boolean; folder?: string; content?: string; error?: string }> {
    try {
      const content = await Filesystem.readFile({ path: `${folder}/questions.md`, directory: Directory.Documents, encoding: Encoding.UTF8 });
      return { success: true, folder, content: typeof content.data === 'string' ? content.data : '' };
    } catch (error: any) {
      return { success: false, folder, error: error?.message || '读取题册失败' };
    }
  }
  async chooseBook(): Promise<{ canceled?: boolean; path?: string; originalPath?: string; name?: string; coverPath?: string; coverError?: string }> {
    try {
      const file = await pickFileViaInput('.pdf,.epub,.mobi,.azw3,.docx,.txt');
      if (!file) return { canceled: true };
      // 拷贝入托管目录（二进制以 base64 写入）
      const folder = `${this.workspaceRoot}/books/${Date.now()}-${file.name.replace(/[<>:"/\\|?*]/g, '_')}`;
      const target = `${folder}/${file.name}`;
      const bytes = await readFileAsBytes(file);
      await Filesystem.writeFile({ path: target, data: bytesToBase64(bytes), directory: Directory.Documents, recursive: true });
      const uri = (await Filesystem.getUri({ path: target, directory: Directory.Documents })).uri;
      return { path: uri, originalPath: file.name, name: file.name, coverError: '移动端暂不支持自动生成书籍封面' };
    } catch (error: any) {
      return { canceled: true, coverError: error?.message };
    }
  }
  async generateBookCover(): Promise<{ success: boolean; coverPath?: string; error?: string }> {
    return { success: false, error: '移动端不支持本地生成书籍封面' };
  }
  async openWorkspacePath(target: string): Promise<OpResult & { path?: string }> {
    try {
      await Share.share({ title: '暮雨笺文件', url: target });
      return { success: true, path: target };
    } catch {
      return { success: true, path: target };
    }
  }
  async openWorkspaceExamples(): Promise<OpResult & { path?: string }> { return UNAVAILABLE; }
  async getQuestionBookSkill(): Promise<WorkspaceSkillResult> { return { success: false, error: '内置技能随安装包打包，移动端暂不展示' }; }
  async getPlanImportSkill(): Promise<WorkspaceSkillResult> { return { success: false, error: '内置技能随安装包打包，移动端暂不展示' }; }
}

class CapacitorExporter {
  async getDataPath(): Promise<string> { return `Documents/${DATA_DIR}`; }
  async exportData(): Promise<string> {
    const notes = await readJsonFile(FILE_NOTES, '[]');
    const attachments = await readJsonFile(FILE_ATTACHMENTS, '[]');
    const settings = await new CapacitorKVStore().getSettings();
    return JSON.stringify({ notes, attachments, settings });
  }
  async importData(dataJson: string): Promise<OpResult> {
    try {
      const data = JSON.parse(dataJson) as { notes?: string; attachments?: string; settings?: Record<string, unknown> };
      if (typeof data.notes === 'string') await writeJsonFile(FILE_NOTES, data.notes);
      if (typeof data.attachments === 'string') await writeJsonFile(FILE_ATTACHMENTS, data.attachments);
      if (data.settings) localStorage.setItem(KV_SETTINGS, JSON.stringify(data.settings));
      return { success: true };
    } catch (error: any) { return { success: false, error: error?.message || '导入失败' }; }
  }
  async exportWord(title: string, content: string): Promise<{ success: boolean; path?: string; error?: string }> {
    const filename = `${title.replace(/[<>:"/\\|?*]/g, '_')}.doc`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head><body><pre>${escapeHtml(content)}</pre></body></html>`;
    return shareFile(filename, html, 'application/msword');
  }
  async exportPdf(title: string, content: string): Promise<{ success: boolean; path?: string; error?: string }> {
    // 降级：导出 HTML（可由任何浏览器打印为 PDF）；jsPDF 排版增强见 Phase 4
    const filename = `${title.replace(/[<>:"/\\|?*]/g, '_')}.pdf.html`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head><body><pre>${escapeHtml(content)}</pre></body></html>`;
    return shareFile(filename, html, 'text/html');
  }
  async pandocCompile(): Promise<{ success: boolean; html?: string; error?: string }> {
    return { success: false, error: '移动端不支持 pandoc 编译，已自动使用 KaTeX 预览' };
  }
  async exportMarkdown(title: string, content: string): Promise<{ success: boolean; path?: string; error?: string }> {
    const filename = `${title.replace(/[<>:"/\\|?*]/g, '_')}.md`;
    return shareFile(filename, content, 'text/markdown');
  }
  async exportHtml(title: string, html: string): Promise<{ success: boolean; path?: string; error?: string }> {
    const filename = `${title.replace(/[<>:"/\\|?*]/g, '_')}.html`;
    return shareFile(filename, html, 'text/html');
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class CapacitorNotifier {
  async notify(title: string, body: string): Promise<boolean> {
    try {
      await LocalNotifications.requestPermissions();
      await LocalNotifications.schedule({
        notifications: [{ id: Date.now() % 100000, title, body, smallIcon: 'ic_launcher' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}

class CapacitorFilePicker {
  async pickImage(): Promise<PickedFile | null> {
    const file = await pickFileViaInput('image/*');
    return file ? { uri: file.name, name: file.name, mimeType: file.type } : null;
  }
  async pickAnyFile(): Promise<PickedFile | null> {
    const file = await pickFileViaInput('');
    return file ? { uri: file.name, name: file.name, mimeType: file.type } : null;
  }
  async pickDirectory(): Promise<PickedDirectory | null> {
    const file = await pickFileViaInput('');
    return file ? { uri: file.name, name: file.name } : null;
  }
}

export class CapacitorBridge extends BaseBridge {
  override platform: PlatformBridge['platform'] = 'capacitor';
  override notes = new CapacitorNoteRepo();
  override timers = new CapacitorTimerRepo();
  override kv = new CapacitorKVStore();
  override workspace = new CapacitorWorkspaceRepo();
  override exporter = new CapacitorExporter();
  override events = new BaseEventBus();
  override notifier = new CapacitorNotifier();
  override window = new BaseWindowOps();
  override picker = new CapacitorFilePicker();
}

export function createCapacitorBridge(): CapacitorBridge {
  return new CapacitorBridge();
}