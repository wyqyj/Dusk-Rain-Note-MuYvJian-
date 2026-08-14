import { create } from 'zustand';

export type NoteType = 'note' | 'todo' | 'canvas';

export type CanvasItemType = 'text' | 'image' | 'note';

export interface CanvasItem {
  id: string;
  type: CanvasItemType;
  x: number;
  y: number;
  width: number;
  height?: number;
  content: string;
  color?: string;
  attachmentId?: string;
}

export interface CanvasLink {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  color?: string;
}

export interface CanvasOutlineItem {
  label: string;
  itemId: string;
}

export interface NoteVersion {
  id: string;
  savedAt: number;
  title: string;
  content: string;
  canvasItems?: CanvasItem[];
  canvasLinks?: CanvasLink[];
  canvasWallpaper?: string;
  canvasWallpaperFit?: 'cover' | 'contain' | 'repeat';
  canvasOutline?: CanvasOutlineItem[];
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  deadline?: number;
  isTodayPlan: boolean;
  noteType: NoteType;
  isArchived: boolean;
  isPinned?: boolean;
  pinnedInTags?: string[];
  isDeleted?: boolean;
  deletedAt?: number;
  canvasItems?: CanvasItem[];
  canvasLinks?: CanvasLink[];
  canvasWallpaper?: string;
  canvasWallpaperFit?: 'cover' | 'contain' | 'repeat';
  canvasOutline?: CanvasOutlineItem[];
  kanbanStatus?: 'todo' | 'doing' | 'done';
  history?: NoteVersion[];
}

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
    if (reloading) return;
    const json = JSON.stringify(notes, null, 2);
    if (json === lastSavedJson) return;
    lastSavedJson = json;
    if (window.electronAPI) {
      window.electronAPI.saveNotes(json);
    } else {
      try { localStorage.setItem('lingxi-notes', json); } catch {}
    }
  }, 300);
}

export function validateNotes(data: any[]): Note[] {
  if (!Array.isArray(data)) return [];
  return data.filter((n): n is Note =>
    n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.content === 'string'
  ).map((note) => ({
    ...note,
    noteType: note.noteType === 'canvas' || note.noteType === 'todo' ? note.noteType : 'note',
    canvasItems: Array.isArray(note.canvasItems) ? note.canvasItems.filter((item: any) =>
      item && typeof item.id === 'string' && (item.type === 'text' || item.type === 'image' || item.type === 'note') &&
      Number.isFinite(item.x) && Number.isFinite(item.y) && typeof item.content === 'string'
    ).map((item: CanvasItem) => ({ ...item, width: Number.isFinite(item.width) ? item.width : item.type === 'image' ? 320 : 260, height: Number.isFinite(item.height) ? item.height : undefined })) : undefined,
    canvasLinks: Array.isArray(note.canvasLinks) ? note.canvasLinks.filter((link: any) =>
      link && typeof link.id === 'string' && typeof link.fromId === 'string' && typeof link.toId === 'string'
    ) : undefined,
    canvasWallpaper: typeof note.canvasWallpaper === 'string' && note.canvasWallpaper.startsWith('data:image/') ? note.canvasWallpaper : undefined,
    canvasWallpaperFit: note.canvasWallpaperFit === 'contain' || note.canvasWallpaperFit === 'repeat' ? note.canvasWallpaperFit : 'cover',
    canvasOutline: Array.isArray(note.canvasOutline) ? note.canvasOutline.filter((item: any) => item && typeof item.label === 'string' && typeof item.itemId === 'string') : undefined,
    kanbanStatus: note.kanbanStatus === 'doing' || note.kanbanStatus === 'done' ? note.kanbanStatus : 'todo',
    history: Array.isArray(note.history) ? note.history.filter((version: any) =>
      version && typeof version.id === 'string' && Number.isFinite(version.savedAt) && typeof version.title === 'string' && typeof version.content === 'string'
    ).slice(-20) : [],
  }));
}

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [],
  activeNoteId: null,
  loaded: false,

  loadNotes: async () => {
    let notes: Note[] = [];
    if (window.electronAPI) {
      try {
        const data = await window.electronAPI.getNotes();
        const parsed = JSON.parse(data);
        notes = validateNotes(parsed);
      } catch { notes = []; }
    } else {
      try {
        const data = localStorage.getItem('lingxi-notes');
        notes = data ? validateNotes(JSON.parse(data)) : [];
      } catch { notes = []; }
    }
    // 自动迁移：isTodayPlan → noteType
    let migrated = false;
    notes = notes.map(n => {
      if (n.isTodayPlan && !n.noteType) {
        migrated = true;
        return { ...n, noteType: 'todo' as const };
      }
      if (!n.noteType) {
        return { ...n, noteType: 'note' as const };
      }
      return n;
    });
    if (migrated) {
      lastSavedJson = JSON.stringify(notes, null, 2);
      if (window.electronAPI) window.electronAPI.saveNotes(lastSavedJson);
    } else {
      lastSavedJson = JSON.stringify(notes, null, 2);
    }
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
  if (!window.electronAPI?.onReloadNotes) return;
  window.electronAPI.onReloadNotes(async () => {
    if (!window.electronAPI) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    reloading = true;
    try {
      const data = await window.electronAPI.getNotes();
      const notes = validateNotes(JSON.parse(data));
      lastSavedJson = JSON.stringify(notes, null, 2);
      useNoteStore.setState({ notes });
    } catch {} finally {
      reloading = false;
    }
  });
}
