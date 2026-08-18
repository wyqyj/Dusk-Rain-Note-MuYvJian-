/**
 * adapters/memory/index.ts — 内存适配器（测试替身 + 无桥降级）
 *
 * 数据仅存于内存 Map：进程内可用、刷新即失。
 * 用途：① vitest 单测注入；② 演示/降级模式；③ 浏览器开发早期调试。
 */

import type {
  CancelableResult, PlatformBridge, WorkspaceSkillResult,
} from '../../ports';
import {
  BaseBridge, BaseEventBus, BaseWorkspaceRepo,
} from '../base';

class MemoryNoteRepo {
  platform = 'memory';
  private notes = '[]';
  private attachments = '[]';
  private quickNote = '';
  setSeed(notes: unknown[], attachments: unknown[] = []): void {
    this.notes = JSON.stringify(notes);
    this.attachments = JSON.stringify(attachments);
  }
  async getNotes(): Promise<string> { return this.notes; }
  async saveNotes(json: string): Promise<{ success: boolean }> { this.notes = json; return { success: true }; }
  async getAttachments(): Promise<string> { return this.attachments; }
  async saveAttachments(json: string): Promise<{ success: boolean }> { this.attachments = json; return { success: true }; }
  async getQuickNote(): Promise<string> { return this.quickNote; }
  saveQuickNote(content: string): void { this.quickNote = content; }
  async createQuickNote(noteJson: string): Promise<{ success: boolean; noteId?: string; error?: string }> {
    try {
      const note = JSON.parse(noteJson) as { id?: string };
      const id = note?.id || `note-${Date.now().toString(36)}`;
      this.notes = JSON.stringify([...JSON.parse(this.notes), { ...JSON.parse(noteJson), id }]);
      return { success: true, noteId: id };
    } catch (error: any) {
      return { success: false, error: error?.message || 'createQuickNote 失败' };
    }
  }
  async updateQuickNoteContent(noteId: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      const notes = JSON.parse(this.notes) as any[];
      this.notes = JSON.stringify(notes.map((n) => (n.id === noteId ? { ...n, content, updatedAt: Date.now() } : n)));
      return { success: true };
    } catch { return { success: false, error: '更新失败' }; }
  }
  async updateQuickNote(noteId: string, updatesJson: string): Promise<{ success: boolean; error?: string }> {
    try {
      const updates = JSON.parse(updatesJson) as Record<string, unknown>;
      const notes = JSON.parse(this.notes) as any[];
      this.notes = JSON.stringify(notes.map((n) => (n.id === noteId ? { ...n, ...updates, updatedAt: Date.now() } : n)));
      return { success: true };
    } catch { return { success: false, error: '更新失败' }; }
  }
}

class MemoryKV {
  private map = new Map<string, unknown>();
  setSeed(values: Record<string, unknown>): void { this.map = new Map(Object.entries(values)); }
  async getSettings(): Promise<Record<string, unknown>> {
    return (this.map.get('settings') as Record<string, unknown>) || {};
  }
  saveSettings(settings: Record<string, unknown>): void { this.map.set('settings', settings); }
  updateTheme(): void {}
}

class MemoryWorkspaceRepo extends BaseWorkspaceRepo {
  private state = '';
  private root = '(内存工作台)';
  setSeed(state: unknown, root = '(内存工作台)'): void { this.state = state ? JSON.stringify(state) : ''; this.root = root; }
  async getWorkspaceState(): Promise<string> { return this.state; }
  async saveWorkspaceState(stateJson: string): Promise<{ success: boolean }> { this.state = stateJson; return { success: true }; }
  async getWorkspaceRoot(): Promise<string> { return this.root; }
  async chooseWorkspaceRoot(): Promise<CancelableResult> { return { path: this.root }; }
  async migrateWorkspace(): Promise<{ success: boolean; root?: string }> { return { success: true, root: this.root }; }
  async backupWorkspace(): Promise<{ success: boolean; path?: string; error?: string }> { return { success: true, path: this.root }; }
  async restoreWorkspace(): Promise<{ success: boolean; files?: number }> { return { success: true, files: 0 }; }
  async getQuestionBookSkill(): Promise<WorkspaceSkillResult> { return { success: true, prompt: '（内存模式无内置技能）' }; }
  async getPlanImportSkill(): Promise<WorkspaceSkillResult> { return { success: true, prompt: '（内存模式无内置技能）' }; }
}

export class MemoryBridge extends BaseBridge {
  override platform: PlatformBridge['platform'] = 'memory';
  override notes = new MemoryNoteRepo() as unknown as PlatformBridge['notes'];
  override kv = new MemoryKV() as unknown as PlatformBridge['kv'];
  override workspace = new MemoryWorkspaceRepo() as unknown as PlatformBridge['workspace'];
  override events = new BaseEventBus();
}

export function createMemoryBridge(): MemoryBridge {
  return new MemoryBridge();
}