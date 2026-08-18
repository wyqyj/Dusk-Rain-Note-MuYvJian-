import React, { useState } from 'react';
import { useNoteStore } from '../store/noteStore';
import { useUIStore } from '../store/uiStore';
import { useSettingsStore } from '../store/settingsStore';
import { extractTasks, toggleTaskCheckbox } from '../../core/utils/markdown';
import { CountdownBadge } from './CountdownBadge';

const TaskItem: React.FC<{ task: { text: string; checked: boolean; lineIndex: number }; onToggle: () => void; onComplete: () => void }> = ({ task, onToggle, onComplete }) => {
  return (
    <li className="flex items-center gap-2">
      <input type="checkbox" checked={task.checked} onChange={onToggle}
        className="w-4 h-4 rounded border-gray-300 text-indigo-400 focus:ring-indigo-300 cursor-pointer accent-indigo-400" />
      <span className={`flex-1 text-sm ${task.checked ? 'line-through text-gray-300 dark:text-gray-600' : 'text-gray-600 dark:text-gray-300'}`}>{task.text}</span>
      {!task.checked && (
        <button onClick={onComplete}
          className="px-2 py-0.5 text-[10px] rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all">
          完成
        </button>
      )}
    </li>
  );
};

export const TodayPlan: React.FC = () => {
  const { getTodoNotes, updateNote, setActiveNoteId } = useNoteStore();
  const { setShowTodayPlan } = useUIStore();
  const { t } = useSettingsStore();
  const todayNotes = getTodoNotes();
  const [newTaskTexts, setNewTaskTexts] = useState<Record<string, string>>({});

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

  if (todayNotes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-white to-slate-50 dark:from-gray-900 dark:to-gray-950">
        <div className="text-center text-gray-300 dark:text-gray-600">
          <svg className="w-20 h-20 mx-auto mb-4 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <p className="text-base">{t.noTodayPlan}</p>
          <p className="text-sm mt-1 opacity-60">{t.todayPlanDesc}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-white to-slate-50/50 dark:from-gray-900 dark:to-gray-950 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100/60 dark:border-gray-800">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100 tracking-wide">{t.todayPlanView}</h1>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
          {todayNotes.length} {t.tasks}，{todayNotes.reduce((sum, n) => sum + extractTasks(n.content).length, 0)} {t.totalTasks}
        </p>
      </div>
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {todayNotes.map((note) => {
          const tasks = extractTasks(note.content);
          const completedCount = tasks.filter((tk) => tk.checked).length;
          const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;
          return (
            <div key={note.id} className="bg-white/80 dark:bg-gray-800/50 rounded-xl p-4 border border-slate-100/40 dark:border-gray-700/50 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => { setActiveNoteId(note.id); setShowTodayPlan(false); }}
                  className="text-left font-medium text-gray-800 dark:text-gray-200 hover:text-indigo-500 transition-colors">{note.title}</button>
                <div className="flex items-center gap-2">
                  {note.deadline && <CountdownBadge deadline={note.deadline} />}
                  <span className="text-xs text-gray-400">{completedCount}/{tasks.length}</span>
                  {completedCount < tasks.length && (
                    <button onClick={() => handleCompleteAll(note.id)}
                      className="px-2.5 py-1 text-xs rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-sm active:scale-95">
                      全部完成
                    </button>
                  )}
                </div>
              </div>
              {tasks.length > 0 && (
                <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full mb-3 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-indigo-400 to-slate-400 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
              )}
              {tasks.length > 0 && (
                <ul className="space-y-1.5 mb-3">
                  {tasks.map((task, index) => (
                    <TaskItem key={index} task={task} onToggle={() => handleToggleTask(note.id, task.lineIndex, !task.checked)} onComplete={() => handleToggleTask(note.id, task.lineIndex, true)} />
                  ))}
                </ul>
              )}
              {/* 添加任务输入框 */}
              <div className="flex items-start gap-2 mt-2 pt-2 border-t border-slate-100/40 dark:border-gray-700/30">
                <svg className="w-4 h-4 text-indigo-300 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                  className="flex-1 text-sm bg-transparent border-none outline-none text-gray-600 dark:text-gray-300 placeholder:text-gray-300 resize-none" />
                <button onClick={() => handleAddTask(note.id)}
                  className="px-2 py-1 text-xs rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all">
                  添加
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
