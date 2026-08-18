import { create } from 'zustand';
import type { Note, NoteType, NoteVersion } from '../../core/domain/types';
export type { CanvasItem, CanvasItemType, CanvasLink, CanvasOutlineItem, Note, NoteType, NoteVersion } from '../../core/domain/types';
import { validateNotes, migrateNotes } from '../../core/validation/note';
export { validateNotes };
import { getBridge } from '../../platform/container';

interface NoteStore {
  notes: Note[];
  activeNoteId: string | null;
  loaded: boolean;

  setNotes: (notes: Note[]) => void;
  addNote: (note: Note) => void;
  updateContent: (id: string, content: string) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  restoreNote: (id: string) => void;
  permanentDelete: (id: string) => void;
  emptyTrash: () => void;
  archiveNote: (id: string) => void;
  togglePin: (id: string) => void;
  togglePinInTag: (id: string, tag: string) => void;
  setActiveNoteId: (id: string | null) => void;
  loadNotes: () => Promise<void>;
  getTodoNotes: () => Note[];
  getTodayPlanNotes: () => Note[];
  selectNote: (id: string) => void;
  restoreVersion: (id: string, versionId: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedJson = '';
let reloading = false;
const historyTimestamps = new Map<string, number>();

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createVersion(note: Note): NoteVersion {
  return {
    id: `${note.id}-${Date.now().toString(36)}`,
    savedAt: Date.now(),
    title: note.title,
    content: note.content,
    canvasItems: note.canvasItems ? cloneValue(note.canvasItems) : undefined,
    canvasLinks: note.canvasLinks ? cloneValue(note.canvasLinks) : undefined,
    canvasWallpaper: note.canvasWallpaper,
    canvasWallpaperFit: note.canvasWallpaperFit,
    canvasOutline: note.canvasOutline ? cloneValue(note.canvasOutline) : undefined,
  };
}
function saveToDisk(notes: Note[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (reloading) return;
    const json = JSON.stringify(notes, null, 2);
    if (json === lastSavedJson) return;
    lastSavedJson = json;
    void getBridge().notes.saveNotes(json).catch(() => {
      // Keep the in-memory state; a later edit will retry the write.
    });
  }, 500);
}

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [],
  activeNoteId: null,
  loaded: false,

  loadNotes: async () => {
    let notes: Note[] = [];
    try {
      const data = await getBridge().notes.getNotes();
      const parsed = JSON.parse(data || '[]');
      notes = validateNotes(parsed);
    } catch { notes = []; }
    // 自动迁移：isTodayPlan → noteType（core/validation 统一迁移规则）
    const migration = migrateNotes(notes);
    notes = migration.notes;
    lastSavedJson = JSON.stringify(notes, null, 2);
    if (migration.migrated) void getBridge().notes.saveNotes(lastSavedJson);
    set({ notes, loaded: true });
  },

  setNotes: (notes) => { set({ notes }); saveToDisk(notes); },

  addNote: (note) => {
    const updated = [note, ...get().notes];
    set({ notes: updated });
    saveToDisk(updated);
  },

  updateContent: (id, content) => {
    const notes = get().notes;
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    const note = notes[idx];
    if (!note) return;
    if (note.content === content) return;
    const updated = [...notes];
    updated[idx] = { ...note, content, updatedAt: Date.now() };
    set({ notes: updated });
    saveToDisk(updated);
  },

  updateNote: (id, updates) => {
    const shouldSnapshot = !('history' in updates) && ['title', 'content', 'canvasItems', 'canvasLinks', 'canvasWallpaper', 'canvasWallpaperFit', 'canvasOutline', 'kanbanStatus'].some((key) => key in updates);
    const updated = get().notes.map((n) => {
      if (n.id !== id) return n;
      const lastSnapshot = historyTimestamps.get(id) || 0;
      const history = shouldSnapshot && Date.now() - lastSnapshot > 10000
        ? [...(n.history || []), createVersion(n)].slice(-20)
        : n.history;
      if (shouldSnapshot && history !== n.history) historyTimestamps.set(id, Date.now());
      return { ...n, ...updates, history, updatedAt: Date.now() };
    });
    set({ notes: updated });
    saveToDisk(updated);
  },

  deleteNote: (id) => {
    get().updateNote(id, { isDeleted: true, deletedAt: Date.now() });
    if (get().activeNoteId === id) set({ activeNoteId: null });
  },

  restoreNote: (id) => {
    get().updateNote(id, { isDeleted: false, deletedAt: undefined });
  },

  permanentDelete: (id) => {
    const updated = get().notes.filter((n) => n.id !== id);
    set({ notes: updated, activeNoteId: get().activeNoteId === id ? null : get().activeNoteId });
    saveToDisk(updated);
  },

  emptyTrash: () => {
    const updated = get().notes.filter((n) => !n.isDeleted);
    set({ notes: updated, activeNoteId: null });
    saveToDisk(updated);
  },

  archiveNote: (id) => {
    const note = get().notes.find((n) => n.id === id);
    if (note) get().updateNote(id, { isArchived: !note.isArchived });
  },

  togglePin: (id) => {
    const note = get().notes.find((n) => n.id === id);
    if (!note) return;
    const newPinned = !note.isPinned;
    get().updateNote(id, { isPinned: newPinned });
  },

  togglePinInTag: (id, tag) => {
    const note = get().notes.find((n) => n.id === id);
    if (!note) return;
    const current = note.pinnedInTags || [];
    const next = current.includes(tag)
      ? current.filter(t => t !== tag)
      : [...current, tag];
    get().updateNote(id, { pinnedInTags: next });
  },

  setActiveNoteId: (id) => set({ activeNoteId: id }),

  getTodoNotes: () => get().notes.filter((n) => (n.noteType === 'todo' || n.isTodayPlan) && !n.isArchived),

  getTodayPlanNotes: () => get().notes.filter((n) => (n.noteType === 'todo' || n.isTodayPlan) && !n.isArchived),

  selectNote: (id) => {
    const exists = get().notes.some((n) => n.id === id);
    if (exists) set({ activeNoteId: id });
  },

  restoreVersion: (id, versionId) => {
    const note = get().notes.find((entry) => entry.id === id);
    const version = note?.history?.find((entry) => entry.id === versionId);
    if (!note || !version) return;
    get().updateNote(id, {
      title: version.title,
      content: version.content,
      canvasItems: version.canvasItems ? cloneValue(version.canvasItems) : [],
      canvasLinks: version.canvasLinks ? cloneValue(version.canvasLinks) : [],
      canvasWallpaper: version.canvasWallpaper,
      canvasWallpaperFit: version.canvasWallpaperFit,
    });
  },
}));

export function registerReloadListener(): void {
  getBridge().events.onReloadNotes(async () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    reloading = true;
    try {
      const data = await getBridge().notes.getNotes();
      const notes = validateNotes(JSON.parse(data || '[]'));
      lastSavedJson = JSON.stringify(notes, null, 2);
      useNoteStore.setState({ notes });
    } catch {} finally {
      reloading = false;
    }
  });
}
