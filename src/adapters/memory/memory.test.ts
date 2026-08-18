import { describe, expect, it, beforeEach } from 'vitest';
import { createMemoryBridge } from './index';
import { initBridge, getBridge, resetBridge } from '../../platform/container';

describe('adapters/memory — 内存桥（测试替身 + 降级）', () => {
  beforeEach(() => {
    resetBridge();
    initBridge(createMemoryBridge());
  });

  it('便签持久化往返', async () => {
    const bridge = getBridge();
    const json = JSON.stringify([{ id: 'n1', title: '测试', content: 'hello' }]);
    await bridge.notes.saveNotes(json);
    expect(await bridge.notes.getNotes()).toBe(json);
  });

  it('createQuickNote 生成 noteId 并入列', async () => {
    const bridge = getBridge();
    const result = await bridge.notes.createQuickNote(JSON.stringify({ title: '随笔记', content: '' }));
    expect(result.success).toBe(true);
    expect(result.noteId).toBeTruthy();
    const notes = JSON.parse(await bridge.notes.getNotes());
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(result.noteId);
  });

  it('updateQuickNoteContent 更新指定便签', async () => {
    const bridge = getBridge();
    const created = await bridge.notes.createQuickNote(JSON.stringify({ title: 't', content: 'a' }));
    const updated = await bridge.notes.updateQuickNoteContent(created.noteId!, 'b');
    expect(updated.success).toBe(true);
    const notes = JSON.parse(await bridge.notes.getNotes());
    expect(notes[0].content).toBe('b');
  });

  it('工作台状态读写', async () => {
    const bridge = getBridge();
    await bridge.workspace.saveWorkspaceState('{"version":3}');
    expect(await bridge.workspace.getWorkspaceState()).toBe('{"version":3}');
  });

  it('未初始化时 getBridge 抛错（显式注入纪律）', () => {
    resetBridge();
    expect(() => getBridge()).toThrow(/PlatformBridge/);
  });
});