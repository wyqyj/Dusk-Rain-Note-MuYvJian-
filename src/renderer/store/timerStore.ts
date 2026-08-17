import { create } from 'zustand';

export interface TimeRecord {
  taskId: string;
  noteId: string;
  taskText: string;
  noteTitle: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  date: string;
}

interface ActiveSession {
  taskId: string;
  noteId: string;
  taskText: string;
  noteTitle: string;
  startedAt: number;
  pausedMs: number;
}

function isActiveSession(value: unknown): value is ActiveSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<ActiveSession>;
  return typeof session.taskId === 'string' && typeof session.noteId === 'string' && typeof session.taskText === 'string'
    && typeof session.noteTitle === 'string' && Number.isFinite(session.startedAt) && Number.isFinite(session.pausedMs);
}

interface TimerStore {
  activeSession: ActiveSession | null;
  running: boolean;
  displayMs: number;

  startTimer: (taskId: string, noteId: string, taskText: string, noteTitle: string) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: () => Promise<void>;
  loadFromDisk: () => Promise<void>;
}

let tickInterval: ReturnType<typeof setInterval> | null = null;

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const useTimerStore = create<TimerStore>((set, get) => ({
  activeSession: null,
  running: false,
  displayMs: 0,

  startTimer: (taskId, noteId, taskText, noteTitle) => {
    const state = get();
    if (state.activeSession) {
      // 先同步停止旧会话（不等待，但确保状态清理）
      const { activeSession, displayMs } = state;
      const now = Date.now();
      const finalMs = state.running
        ? (displayMs > 0 ? displayMs : now - activeSession.startedAt + activeSession.pausedMs)
        : activeSession.pausedMs;
      if (finalMs > 0) {
        const record: TimeRecord = {
          taskId: activeSession.taskId,
          noteId: activeSession.noteId,
          taskText: activeSession.taskText,
          noteTitle: activeSession.noteTitle,
          startedAt: activeSession.startedAt - activeSession.pausedMs,
          endedAt: now,
          durationMs: finalMs,
          date: formatDate(now),
        };
        window.electronAPI?.saveTimerRecord(record);
      }
      window.electronAPI?.saveActiveSession(null);
    }

    const session: ActiveSession = {
      taskId, noteId, taskText, noteTitle,
      startedAt: Date.now(),
      pausedMs: 0,
    };
    set({ activeSession: session, running: true, displayMs: 0 });
    window.electronAPI?.saveActiveSession(session);

    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      const s = get();
      if (s.activeSession && s.running) {
        const elapsed = Date.now() - s.activeSession.startedAt + s.activeSession.pausedMs;
        set({ displayMs: elapsed });
      }
    }, 1000);
  },

  pauseTimer: () => {
    const { activeSession, displayMs } = get();
    if (!activeSession) return;
    const updated = { ...activeSession, pausedMs: displayMs, startedAt: Date.now() };
    set({ activeSession: updated, running: false });
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    window.electronAPI?.saveActiveSession(updated);
  },

  resumeTimer: () => {
    const { activeSession } = get();
    if (!activeSession) return;
    const updated = { ...activeSession, startedAt: Date.now() };
    set({ activeSession: updated, running: true });
    window.electronAPI?.saveActiveSession(updated);

    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      const s = get();
      if (s.activeSession && s.running) {
        const elapsed = Date.now() - s.activeSession.startedAt + s.activeSession.pausedMs;
        set({ displayMs: elapsed });
      }
    }, 1000);
  },

  stopTimer: async () => {
    const { activeSession, displayMs, running } = get();
    if (!activeSession) return;

    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }

    const now = Date.now();
    const finalMs = running
      ? (displayMs > 0 ? displayMs : now - activeSession.startedAt + activeSession.pausedMs)
      : activeSession.pausedMs;

    // 先清理状态，防止重复调用
    set({ activeSession: null, running: false, displayMs: 0 });

    if (finalMs > 0) {
      const record: TimeRecord = {
        taskId: activeSession.taskId,
        noteId: activeSession.noteId,
        taskText: activeSession.taskText,
        noteTitle: activeSession.noteTitle,
        startedAt: activeSession.startedAt - activeSession.pausedMs,
        endedAt: now,
        durationMs: finalMs,
        date: formatDate(now),
      };
      // 等待保存完成
      if (window.electronAPI) {
        try {
          await window.electronAPI.saveTimerRecord(record);
          await window.electronAPI.saveActiveSession(null);
        } catch (e) {
          console.error('[TimerStore] save failed:', e);
        }
      }
    } else {
      window.electronAPI?.saveActiveSession(null);
    }
  },

  loadFromDisk: async () => {
    if (!window.electronAPI) return;
    try {
      const session = await window.electronAPI.loadActiveSession();
      if (isActiveSession(session)) {
        set({ activeSession: session, running: false, displayMs: session.pausedMs || 0 });
      }
    } catch {}
  },
}));

// ========== 任务截止时间存储 ==========

interface TaskDeadlineStore {
  deadlines: Record<string, number>;
  setDeadline: (taskId: string, deadline: number) => void;
  removeDeadline: (taskId: string) => void;
  getDeadline: (taskId: string) => number | undefined;
  loadFromStorage: () => void;
}

const DEADLINE_STORAGE_KEY = 'muyujian-task-deadlines';

function loadDeadlines(): Record<string, number> {
  try { const raw = localStorage.getItem(DEADLINE_STORAGE_KEY); if (raw) return JSON.parse(raw); } catch {}
  return {};
}

function saveDeadlines(deadlines: Record<string, number>): void {
  try { localStorage.setItem(DEADLINE_STORAGE_KEY, JSON.stringify(deadlines)); } catch {}
}

export const useTaskDeadlineStore = create<TaskDeadlineStore>((set, get) => ({
  deadlines: {},
  setDeadline: (taskId, deadline) => { const updated = { ...get().deadlines, [taskId]: deadline }; set({ deadlines: updated }); saveDeadlines(updated); },
  removeDeadline: (taskId) => { const updated = { ...get().deadlines }; delete updated[taskId]; set({ deadlines: updated }); saveDeadlines(updated); },
  getDeadline: (taskId) => get().deadlines[taskId],
  loadFromStorage: () => { set({ deadlines: loadDeadlines() }); },
}));
