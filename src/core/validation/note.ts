/**
 * core/validation/note.ts — 便签数据校验与规范化（自上游 noteStore.validateNotes 提炼）
 *
 * 零平台依赖：输入任意结构，输出合法 Note[]。移动端与桌面共用同一套过滤规则，
 * 保证跨端迁移后数据语义一致。
 */

import type { CanvasItem, CanvasItemType, CanvasLink, CanvasOutlineItem, Note, NoteVersion } from '../domain/types';

export function validateNotes(data: unknown[]): Note[] {
  if (!Array.isArray(data)) return [];
  return data.filter((n): n is Note =>
    Boolean(n) && typeof (n as Note).id === 'string' && typeof (n as Note).title === 'string' && typeof (n as Note).content === 'string'
  ).map((note) => ({
    ...note,
    noteType: note.noteType === 'canvas' || note.noteType === 'todo' ? note.noteType : 'note',
    canvasItems: Array.isArray(note.canvasItems) ? note.canvasItems.filter((item: any): item is CanvasItem =>
      Boolean(item) && typeof item.id === 'string' && (item.type === 'text' || item.type === 'image' || item.type === 'note') &&
      Number.isFinite(item.x) && Number.isFinite(item.y) && typeof item.content === 'string'
    ).map((item) => ({ ...item, width: Number.isFinite(item.width) ? item.width : item.type === 'image' ? 320 : 260, height: Number.isFinite(item.height) ? item.height : undefined })) : undefined,
    canvasLinks: Array.isArray(note.canvasLinks) ? note.canvasLinks.filter((link: any): link is CanvasLink =>
      link && typeof link.id === 'string' && typeof link.fromId === 'string' && typeof link.toId === 'string'
    ) : undefined,
    canvasWallpaper: typeof note.canvasWallpaper === 'string' && note.canvasWallpaper.startsWith('data:image/') ? note.canvasWallpaper : undefined,
    canvasWallpaperFit: note.canvasWallpaperFit === 'contain' || note.canvasWallpaperFit === 'repeat' ? note.canvasWallpaperFit : 'cover',
    canvasOutline: Array.isArray(note.canvasOutline) ? note.canvasOutline.filter((item: any): item is CanvasOutlineItem => item && typeof item.label === 'string' && typeof item.itemId === 'string') : undefined,
    kanbanStatus: note.kanbanStatus === 'doing' || note.kanbanStatus === 'done' ? note.kanbanStatus : 'todo',
    history: Array.isArray(note.history) ? note.history.filter((version: any): version is NoteVersion =>
      version && typeof version.id === 'string' && Number.isFinite(version.savedAt) && typeof version.title === 'string' && typeof version.content === 'string'
    ).slice(-20) : [],
  }));
}

/** 迁移旧字段：isTodayPlan → noteType；补全缺失 noteType。返回是否发生迁移。 */
export function migrateNotes(notes: Note[]): { notes: Note[]; migrated: boolean } {
  let migrated = false;
  const next = notes.map((n) => {
    if ((n as any).isTodayPlan && !n.noteType) {
      migrated = true;
      return { ...n, noteType: 'todo' as const };
    }
    if (!n.noteType) {
      migrated = true;
      return { ...n, noteType: 'note' as const };
    }
    return n;
  });
  return { notes: next, migrated };
}

export type { CanvasItem, CanvasItemType, CanvasLink, CanvasOutlineItem, Note, NoteType, NoteVersion } from '../domain/types';