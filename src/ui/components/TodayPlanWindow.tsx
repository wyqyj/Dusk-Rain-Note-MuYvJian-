import React, { useState, useEffect } from 'react';
import { useNoteStore } from '../store/noteStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTaskDeadlineStore, useTimerStore } from '../store/timerStore';
import { extractTasks, toggleTaskCheckbox, getDeadlineInfo, formatDeadlineDate, generateId } from '../../core/utils/markdown';
import { CountdownBadge } from './CountdownBadge';
import { getBridge } from '../../platform/container';

const TaskDeadlinePicker: React.FC<{
  taskId: string;
  currentDeadline?: number;
  onSet: (deadline: number) => void;
  onRemove: () => void;
  onClose: () => void;
}> = ({ taskId, currentDeadline, onSet, onRemove, onClose }) => {
  const now = new Date();
  const defaultDate = currentDeadline ? new Date(currentDeadline) : new Date(now.getTime() + 3600000);
  const [date, setDate] = useState(defaultDate.toISOString().slice(0, 10));
  const [hour, setHour] = useState(String(defaultDate.getHours()).padStart(2, '0'));
  const [minute, setMinute] = useState(String(defaultDate.getMinutes()).padStart(2, '0'));

  const handleConfirm = () => {
    const d = new Date(date);
    d.setHours(Number(hour), Number(minute), 0, 0);
    if (isNaN(d.getTime())) return;
    onSet(d.getTime());
    onClose();
  };

  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-xl border border-indigo-100 dark:border-gray-700 shadow-lg p-3 w-60"
      onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400">设置截止时间</span>
        {currentDeadline && (
          <button onClick={() => { onRemove(); onClose(); }}
            className="text-[10px] text-red-400 hover:text-red-500">清除</button>
        )}
      </div>
      <div className="space-y-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none focus:ring-1 focus:ring-indigo-300 dark:text-gray-200" />
        <div className="flex items-center gap-2">
          <select value={hour} onChange={(e) => setHour(e.target.value)}
            className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none focus:ring-1 focus:ring-indigo-300 dark:text-gray-200">
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}时</option>
            ))}
          </select>
          <span className="text-gray-300 font-bold">:</span>
          <select value={minute} onChange={(e) => setMinute(e.target.value)}
            className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none focus:ring-1 focus:ring-indigo-300 dark:text-gray-200">
            {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
              <option key={m} value={String(m).padStart(2, '0')}>{String(m).padStart(2, '0')}分</option>
            ))}
          </select>
        </div>
        <button onClick={handleConfirm}
          className="w-full py-1.5 text-xs rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-sm">
          确认
        </button>
      </div>
    </div>
  );
};

function formatTimer(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const TaskTimerButton: React.FC<{
  taskId: string;
  noteId: string;
  taskText: string;
  noteTitle: string;
}> = ({ taskId, noteId, taskText, noteTitle }) => {
  const { activeSession, running, displayMs, startTimer, pauseTimer, resumeTimer, stopTimer } = useTimerStore();
  const isActive = activeSession?.taskId === taskId;

  if (!isActive) {
    return (
      <button onClick={(e) => { e.stopPropagation(); startTimer(taskId, noteId, taskText, noteTitle); }}
        className="p-0.5 rounded text-gray-300 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className={`text-[10px] font-mono tabular-nums min-w-[36px] text-right ${running ? 'text-emerald-500' : 'text-amber-500'}`}>
        {formatTimer(displayMs)}
      </span>
      <button onClick={(e) => { e.stopPropagation(); running ? pauseTimer() : resumeTimer(); }}
        className={`p-0.5 rounded transition-colors ${running
          ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
          : 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}>
        {running ? (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      {!running && (
        <button onClick={(e) => { e.stopPropagation(); stopTimer(); }}
          className="p-0.5 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
        </button>
      )}
    </div>
  );
};

const TaskItem: React.FC<{
  task: { text: string; checked: boolean; lineIndex: number };
  taskId: string;
  noteId: string;
  noteTitle: string;
  onToggle: () => void;
  onComplete: () => void;
}> = ({ task, taskId, noteId, noteTitle, onToggle, onComplete }) => {
  const { deadlines, setDeadline, removeDeadline } = useTaskDeadlineStore();
  const [showPicker, setShowPicker] = useState(false);
  const deadline = deadlines[taskId];

  useEffect(() => {
    if (!showPicker) return;
    const close = () => setShowPicker(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showPicker]);

  return (
    <li className="flex items-center gap-2 group relative">
      <input type="checkbox" checked={task.checked} onChange={onToggle}
        className="w-3.5 h-3.5 rounded border-gray-300 accent-indigo-400 cursor-pointer" />
      <span className={`flex-1 text-xs ${task.checked ? 'line-through text-gray-300 dark:text-gray-600' : 'text-gray-600 dark:text-gray-300'}`}>{task.text}</span>
      {deadline && <CountdownBadge deadline={deadline} />}
      {!task.checked && <TaskTimerButton taskId={taskId} noteId={noteId} taskText={task.text} noteTitle={noteTitle} />}
      {!task.checked && (
        <button onClick={(e) => { e.stopPropagation(); setShowPicker(!showPicker); }}
          className={`p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 ${deadline
            ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 opacity-100'
            : 'text-gray-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      )}
      {!task.checked && (
        <button onClick={onComplete}
          className="px-2 py-0.5 text-[10px] rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all">
          完成
        </button>
      )}
      {showPicker && (
        <TaskDeadlinePicker
          taskId={taskId}
          currentDeadline={deadline}
          onSet={(d) => setDeadline(taskId, d)}
          onRemove={() => removeDeadline(taskId)}
          onClose={() => setShowPicker(false)}
        />
      )}
    </li>
  );
};

export const TodayPlanWindow: React.FC = () => {
  const { getTodoNotes, updateNote, addNote, loadNotes, setActiveNoteId } = useNoteStore();
  const { t, settings } = useSettingsStore();
  const { loadFromStorage } = useTaskDeadlineStore();
  const { loadFromDisk: loadTimerData } = useTimerStore();
  const todayNotes = getTodoNotes();
  const [newTaskTexts, setNewTaskTexts] = useState<Record<string, string>>({});
  const [opacity, setOpacity] = useState(1);

  useEffect(() => { loadNotes(); loadFromStorage(); loadTimerData(); }, []);

  // 窗口关闭时保存计时状态
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { activeSession, running, displayMs } = useTimerStore.getState();
      if (activeSession && running) {
        // 暂停并保存当前进度
        useTimerStore.getState().pauseTimer();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleCreateTodo = () => {
    const note = {
      id: generateId(), title: t.newTodo, content: '- [ ] ', tags: [],
      createdAt: Date.now(), updatedAt: Date.now(), isTodayPlan: true, noteType: 'todo' as const, isArchived: false,
    };
    addNote(note);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  useEffect(() => {
    const bridge = getBridge();
    bridge.events.onReloadNotes(async () => {
      try {
        const data = await bridge.notes.getNotes();
        const { validateNotes } = await import('../store/noteStore');
        const notes = validateNotes(JSON.parse(data || '[]'));
        useNoteStore.setState({ notes });
      } catch {}
    });
  }, []);

  useEffect(() => {
    getBridge().window.getOpacity().then((v: number) => { if (v) setOpacity(v); }).catch(() => {});
  }, []);

  const handleToggleTask = (noteId: string, lineIndex: number, checked: boolean) => {
    const note = todayNotes.find((n) => n.id === noteId);
    if (note) updateNote(noteId, { content: toggleTaskCheckbox(note.content, lineIndex, checked) });
  };

  const handleCompleteAll = (noteId: string) => {
    const note = todayNotes.find((n) => n.id === noteId);
    if (!note) return;
    let content = note.content;
    const tasks = extractTasks(content);
    const unchecked = tasks.filter(t => !t.checked);
    unchecked.sort((a, b) => b.lineIndex - a.lineIndex);
    for (const task of unchecked) {
      content = toggleTaskCheckbox(content, task.lineIndex, true);
    }
    updateNote(noteId, { content });
  };

  const handleAddTask = (noteId: string) => {
    const raw = (newTaskTexts[noteId] || '').trim();
    if (!raw) return;
    const note = todayNotes.find((n) => n.id === noteId);
    if (!note) return;
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const newTasks = lines.map(line => `- [ ] ${line}`).join('\n');
    const newLine = note.content.endsWith('\n') ? '' : '\n';
    updateNote(noteId, { content: note.content + newLine + newTasks });
    setNewTaskTexts(prev => ({ ...prev, [noteId]: '' }));
  };

  const handleOpacityChange = (value: number) => {
    setOpacity(value);
    getBridge().window.setOpacity(value);
  };

  const handleClose = () => getBridge().window.closeTodayPlanWindow();
  const handleMinimize = () => getBridge().window.minimizeTodayPlanWindow();

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-slate-50 to-white dark:from-gray-900 dark:to-gray-950 overflow-hidden select-none">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-slate-100 to-gray-50 dark:from-gray-800 dark:to-gray-800 border-b border-slate-200/60 dark:border-gray-700"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 text-lg">☆</span>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300 tracking-wide">{t.todoView}</span>
          <span className="text-xs text-slate-400">{todayNotes.length} {t.plan}</span>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={handleCreateTodo}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors shadow-sm active:scale-95">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t.newTodo}
          </button>
          <div className="flex items-center gap-1 ml-1">
            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <input type="range" min="20" max="100" value={Math.round(opacity * 100)}
              onChange={(e) => handleOpacityChange(Number(e.target.value) / 100)}
              className="w-16 h-1 accent-indigo-400 cursor-pointer" title={`透明度 ${Math.round(opacity * 100)}%`} />
          </div>
          <button onClick={handleMinimize}
            className="p-1.5 rounded-md hover:bg-white/60 dark:hover:bg-gray-700 text-gray-400 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" /></svg>
          </button>
          <button onClick={handleClose}
            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-400 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {todayNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-300">
            <span className="text-4xl mb-2 opacity-40">☆</span>
            <p className="text-sm">{t.noTodo}</p>
            <p className="text-xs mt-1 opacity-60">{t.todoDesc}</p>
          </div>
        ) : (
          todayNotes.map((note) => {
            const tasks = extractTasks(note.content);
            const completedCount = tasks.filter((tk) => tk.checked).length;
            const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;
            return (
              <div key={note.id} className="bg-white/80 dark:bg-gray-800/50 rounded-xl p-3 border border-slate-100/40 dark:border-gray-700/50 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-gray-800 dark:text-gray-200 text-sm">{note.title}</h3>
                  <div className="flex items-center gap-2">
                    {note.deadline && <CountdownBadge deadline={note.deadline} />}
                    <span className="text-[11px] text-gray-400">{completedCount}/{tasks.length}</span>
                    {completedCount < tasks.length && (
                      <button onClick={() => handleCompleteAll(note.id)}
                        className="px-2 py-0.5 text-[10px] rounded-md bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-sm active:scale-95">
                        全部完成
                      </button>
                    )}
                  </div>
                </div>
                {tasks.length > 0 && (
                  <div className="w-full h-1 bg-gray-100 dark:bg-gray-700 rounded-full mb-2 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-indigo-400 to-slate-400 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                  </div>
                )}
                {tasks.length > 0 && (
                  <ul className="space-y-1.5 mb-2">
                    {tasks.map((task, idx) => (
                      <TaskItem key={idx} task={task} taskId={`${note.id}:${task.lineIndex}`}
                        noteId={note.id} noteTitle={note.title}
                        onToggle={() => handleToggleTask(note.id, task.lineIndex, !task.checked)}
                        onComplete={() => handleToggleTask(note.id, task.lineIndex, true)} />
                    ))}
                  </ul>
                )}
                {/* 添加任务输入框 */}
                <div className="flex items-start gap-2 mt-2 pt-2 border-t border-slate-100/30 dark:border-gray-700/30">
                  <svg className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <textarea placeholder="添加任务（每行一个，Shift+Enter 换行）" value={newTaskTexts[note.id] || ''}
                    onChange={(e) => setNewTaskTexts(prev => ({ ...prev, [note.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAddTask(note.id);
                      }
                    }}
                    rows={1}
                    className="flex-1 text-xs bg-transparent border-none outline-none text-gray-600 dark:text-gray-300 placeholder:text-gray-300 resize-none" />
                  <button onClick={() => handleAddTask(note.id)}
                    className="px-2 py-0.5 text-[10px] rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all">
                    添加
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
