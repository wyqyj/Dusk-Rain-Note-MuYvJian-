import React, { useState, useMemo, useEffect } from 'react';
import { useNoteStore, Note } from '../store/noteStore';
import { useUIStore } from '../store/uiStore';
import { useSettingsStore } from '../store/settingsStore';
import { getBridge } from '../../platform/container';
import { generateId, formatDate, formatDeadlineDate, extractTasks } from '../../core/utils/markdown';
import { isNativeMobile } from '../utils/platform';
import { CountdownBadge } from './CountdownBadge';
import DatePicker from 'react-datepicker';
import { zhCN } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

/** 自定义日期时间选择器 */
const DeadlinePicker: React.FC<{ deadline?: number; onSelect: (ts: number | null) => void }> = ({ deadline, onSelect }) => {
  const selectedDate = deadline ? new Date(deadline) : new Date();
  const [hour, setHour] = useState(selectedDate.getHours());
  const [minute, setMinute] = useState(selectedDate.getMinutes());
  const [currentDate, setCurrentDate] = useState<Date | null>(deadline ? new Date(deadline) : null);

  const handleDateChange = (date: Date | null) => {
    if (!date) return;
    setCurrentDate(date);
  };

  const handleConfirm = () => {
    if (!currentDate) return;
    const d = new Date(currentDate);
    d.setHours(hour, minute, 0, 0);
    onSelect(d.getTime());
  };

  return (
    <div className="mt-2 p-3 bg-white dark:bg-gray-800 rounded-xl border border-indigo-100 dark:border-gray-700 shadow-lg" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400">📅 {deadline ? '修改截止日期' : '设置截止日期'}</span>
        {deadline && (
          <button onClick={() => onSelect(null)} className="text-[10px] text-red-400 hover:text-red-500 transition-colors">清除日期</button>
        )}
      </div>

      {/* 日历 */}
      <DatePicker
        selected={currentDate}
        onChange={handleDateChange}
        minDate={new Date()}
        dateFormat="yyyy年MM月dd日"
        locale={zhCN}
        inline
      />

      {/* 自定义时间选择器 */}
      <div className="flex items-center justify-center gap-2 py-2 mt-1 border-t border-indigo-50 dark:border-gray-700">
        <span className="text-[10px] text-gray-400">时间</span>
        <select value={hour} onChange={(e) => setHour(Number(e.target.value))}
          className="px-2 py-1 text-sm font-mono bg-indigo-50 dark:bg-gray-700 border border-indigo-100 dark:border-gray-600 rounded-lg text-indigo-600 dark:text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer">
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{String(i).padStart(2, '0')}时</option>
          ))}
        </select>
        <span className="text-indigo-300 font-bold">:</span>
        <select value={minute} onChange={(e) => setMinute(Number(e.target.value))}
          className="px-2 py-1 text-sm font-mono bg-indigo-50 dark:bg-gray-700 border border-indigo-100 dark:border-gray-600 rounded-lg text-indigo-600 dark:text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer">
          {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
            <option key={m} value={m}>{String(m).padStart(2, '0')}分</option>
          ))}
        </select>
      </div>

      {/* 预览和确认 */}
      {currentDate && (
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-[10px] text-gray-400">
            {formatDeadlineDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour, minute).getTime())}
          </span>
          <button onClick={handleConfirm}
            className="px-3 py-1 text-xs rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-sm active:scale-95">
            确认
          </button>
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const {
    notes, activeNoteId,
    setActiveNoteId,
    addNote, deleteNote, restoreNote, permanentDelete, emptyTrash, archiveNote, updateNote, togglePin, togglePinInTag,
  } = useNoteStore();
  const {
    searchQuery, filterTags,
    setSearchQuery, toggleFilterTag, clearFilterTags, setShowKanban, setShowWorkbench,
  } = useUIStore();
  const { t } = useSettingsStore();

  const [showDeadlinePicker, setShowDeadlinePicker] = useState<string | null>(null);
  const [showTagInput, setShowTagInput] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [sideSection, setSideSection] = useState<'all' | 'todo' | 'canvas' | 'archived' | 'trash'>('all');

  // 点击外部关闭标签输入
  useEffect(() => {
    if (!showTagInput) return;
    const close = () => { setShowTagInput(null); setNewTag(''); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showTagInput]);

  const allTags = useMemo(() => Array.from(new Set(notes.flatMap((n) => n.tags))), [notes]);
  const todoNotes = useMemo(() => notes.filter((n) => (n.noteType === 'todo' || n.isTodayPlan) && !n.isArchived && !n.isDeleted), [notes]);
  const canvasNotes = useMemo(() => notes.filter((n) => n.noteType === 'canvas' && !n.isArchived && !n.isDeleted), [notes]);
  const archivedNotes = useMemo(() => notes.filter((n) => n.isArchived && !n.isDeleted), [notes]);
  const trashNotes = useMemo(() => notes.filter((n) => n.isDeleted), [notes]);

  const filteredNotes = useMemo(() => {
    const filtered = notes.filter((note) => {
      if (sideSection === 'trash' && !note.isDeleted) return false;
      if (sideSection !== 'trash' && note.isDeleted) return false;
      if (sideSection === 'todo' && note.noteType !== 'todo' && !note.isTodayPlan) return false;
      if (sideSection === 'todo' && note.isArchived) return false;
      if (sideSection === 'canvas' && (note.noteType !== 'canvas' || note.isArchived)) return false;
      if (sideSection === 'archived' && !note.isArchived) return false;
      if (sideSection === 'all' && note.isArchived) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const canvasText = note.canvasItems?.map((item) => item.content).join(' ') || '';
        if (!note.title.toLowerCase().includes(q) && !note.content.toLowerCase().includes(q) && !canvasText.toLowerCase().includes(q)) return false;
      }
      if (filterTags.length > 0) {
        if (!filterTags.every(tag => note.tags.includes(tag))) return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      // 判断是否置顶
      const activeTag = filterTags.length === 1 ? filterTags[0] : null;
      const aPinned = a.isPinned || (activeTag && (a.pinnedInTags || []).includes(activeTag));
      const bPinned = b.isPinned || (activeTag && (b.pinnedInTags || []).includes(activeTag));

      // 待办分类：未完成的待办置顶
      if (sideSection === 'todo') {
        const aIsTodo = a.noteType === 'todo' || a.isTodayPlan;
        const bIsTodo = b.noteType === 'todo' || b.isTodayPlan;
        const aHasUnchecked = aIsTodo && extractTasks(a.content).some(t => !t.checked);
        const bHasUnchecked = bIsTodo && extractTasks(b.content).some(t => !t.checked);
        const aTop = aHasUnchecked || aPinned;
        const bTop = bHasUnchecked || bPinned;
        if (aTop && !bTop) return -1;
        if (!aTop && bTop) return 1;
      } else {
        // 全部/标签分类：仅显式置顶生效
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
      }
      return b.updatedAt - a.updatedAt;
    });
  }, [notes, sideSection, searchQuery, filterTags]);

  const handleCreateNote = () => {
    const note: Note = {
      id: generateId(), title: t.newNote, content: '', tags: [],
      createdAt: Date.now(), updatedAt: Date.now(), isTodayPlan: false, noteType: 'note', isArchived: false,
    };
    addNote(note);
    setActiveNoteId(note.id);
    setSideSection('all');
    clearFilterTags();
  };

  const handleCreateTodo = () => {
    const note: Note = {
      id: generateId(), title: t.newTodo, content: '- [ ] ', tags: [],
      createdAt: Date.now(), updatedAt: Date.now(), isTodayPlan: true, noteType: 'todo', isArchived: false,
    };
    addNote(note);
    setActiveNoteId(note.id);
    setSideSection('todo');
    clearFilterTags();
  };

  const handleCreateCanvas = () => {
    const note: Note = {
      id: generateId(), title: '未命名画布', content: '', tags: [],
      createdAt: Date.now(), updatedAt: Date.now(), isTodayPlan: false, noteType: 'canvas', isArchived: false, canvasItems: [],
    };
    addNote(note);
    setActiveNoteId(note.id);
    setSideSection('canvas');
    clearFilterTags();
  };

  const handleDeleteNote = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(t.deleteConfirm)) deleteNote(id);
  };

  const handleSetDeadline = (id: string, date: Date | null) => {
    if (date) updateNote(id, { deadline: date.getTime() });
    setShowDeadlinePicker(null);
  };

  const handleAddTag = (id: string, e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (newTag.trim()) {
      const note = notes.find((n) => n.id === id);
      if (note && !note.tags.includes(newTag.trim())) {
        updateNote(id, { tags: [...note.tags, newTag.trim()] });
      }
      setNewTag('');
      setShowTagInput(null);
    }
  };

  const handleRemoveTag = (id: string, tag: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const note = notes.find((n) => n.id === id);
    if (note) updateNote(id, { tags: note.tags.filter((tg) => tg !== tag) });
  };

  const getSummary = (content: string): React.ReactNode => {
    const text = content.replace(/[#*\[\]`~>_-]/g, '').replace(/\n+/g, ' ').trim();
    const truncated = text.length > 50 ? text.slice(0, 50) + '…' : text;
    if (!searchQuery) return truncated;
    const q = searchQuery.toLowerCase();
    const idx = truncated.toLowerCase().indexOf(q);
    if (idx === -1) return truncated;
    return (
      <>{truncated.slice(0, idx)}<mark className="bg-amber-200 dark:bg-amber-700 rounded px-0.5">{truncated.slice(idx, idx + q.length)}</mark>{truncated.slice(idx + q.length)}</>
    );
  };

  const openTodayPlanWindow = () => {
    getBridge().window.toggleTodayPlanWindow();
  };

  return (
    <div className="sidebar-panel flex flex-col h-full bg-gradient-to-b from-rose-50/80 to-white dark:from-gray-900 dark:to-gray-950 border-r border-rose-100 dark:border-gray-800">
      {/* 新建按钮 */}
      <div className="sidebar-actions p-3 pb-2">
        <button onClick={handleCreateNote}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-gradient-to-r from-rose-400 to-pink-400 hover:from-rose-500 hover:to-pink-500 text-white rounded-xl text-sm font-medium transition-all shadow-sm hover:shadow-md active:scale-[0.98]">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t.newNote}
        </button>
        {!isNativeMobile() && <button onClick={handleCreateCanvas}
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-indigo-100 dark:border-indigo-900/60 text-indigo-500 dark:text-indigo-300 rounded-lg text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-all">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v16H4zM4 10h16M10 4v16M4 16h16M16 4v16" /></svg>
          新建画布
        </button>}
      </div>

      {/* 分类导航 */}
      <div className="sidebar-navigation px-3 pb-2 space-y-0.5">
        <button onClick={() => { setSideSection('all'); clearFilterTags(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${sideSection === 'all' && filterTags.length === 0
            ? 'bg-white dark:bg-gray-800 text-rose-500 shadow-sm font-medium'
            : 'text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50'}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          {t.all}
          <span className="ml-auto text-xs text-gray-300">{notes.filter(n => !n.isArchived && !n.isDeleted).length}</span>
        </button>

        {!isNativeMobile() && <button onClick={() => { setSideSection('canvas'); clearFilterTags(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${sideSection === 'canvas'
            ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-300 shadow-sm font-medium'
            : 'text-gray-500 dark:text-gray-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20'}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v16H4zM4 10h16M10 4v16M4 16h16M16 4v16" /></svg>
          无限画布
          <span className="ml-auto text-xs text-gray-300">{canvasNotes.length}</span>
        </button>}

        <button onClick={() => { setShowWorkbench(true); setShowKanban(false); }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16M8 15v-3m4 3V8m4 7v-5" /></svg>
          学习工作台
          <span className="ml-auto text-[10px] text-blue-400">v3</span>
        </button>

        <button onClick={() => { setSideSection('todo'); clearFilterTags(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${sideSection === 'todo'
            ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 shadow-sm font-medium'
            : 'text-gray-500 dark:text-gray-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10'}`}>
          <span className="text-amber-400 text-base">☆</span>
          {t.todo}
          <span className="ml-auto text-xs text-gray-300">{todoNotes.length}</span>
        </button>

        {sideSection === 'todo' && (
          <button onClick={handleCreateTodo}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-amber-500 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-all">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t.newTodo}
          </button>
        )}

        <button onClick={() => getBridge().window.toggleTimerStatsWindow()}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          任务统计
        </button>

        <button onClick={() => setShowKanban(true)}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50/70 dark:hover:bg-emerald-900/10 transition-all">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4zM10 5v14M4 10h16" /></svg>
          看板视图
        </button>

        {todoNotes.length > 0 && (
          <button onClick={openTodayPlanWindow}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-amber-500 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-all">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h18v18H3zM3 9h18M9 21V9" />
            </svg>
            悬浮窗口查看
          </button>
        )}

        <button onClick={() => { setSideSection('archived'); clearFilterTags(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${sideSection === 'archived'
            ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 shadow-sm font-medium'
            : 'text-gray-500 dark:text-gray-400 hover:bg-violet-50/50 dark:hover:bg-violet-900/10'}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
          {t.archive}
          <span className="ml-auto text-xs text-gray-300">{archivedNotes.length}</span>
        </button>

        <button onClick={() => { setSideSection('trash'); clearFilterTags(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${sideSection === 'trash'
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 shadow-sm font-medium'
            : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          回收站
          <span className="ml-auto text-xs text-gray-300">{trashNotes.length}</span>
        </button>
      </div>

      {/* 标签分类 */}
      {allTags.length > 0 && (
        <div className="px-3 pb-2">
          <div className="px-3 py-1 text-[10px] font-medium text-gray-300 dark:text-gray-600 uppercase tracking-widest">{t.addTag}</div>
          <div className="flex flex-wrap gap-1.5 px-1">
            {allTags.map((tag) => {
              const count = notes.filter(n => !n.isArchived && n.tags.includes(tag)).length;
              const isSelected = filterTags.includes(tag);
              return (
                <button key={tag} onClick={() => { toggleFilterTag(tag); setSideSection('all'); }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all ${isSelected
                    ? 'bg-rose-400 text-white shadow-sm'
                    : 'bg-rose-50 dark:bg-gray-800 text-rose-500 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-gray-700'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                  {tag}
                  <span className="opacity-50">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 搜索框 */}
      <div className="px-3 pb-2">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder={t.search} value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white/70 dark:bg-gray-800/70 border border-rose-100 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-800 dark:text-gray-200 placeholder:text-gray-300 transition-all" />
        </div>
      </div>

      <div className="mx-3 border-t border-rose-100/40 dark:border-gray-800" />

      {/* 便签列表 */}
      <div className="sidebar-list flex-1 overflow-y-auto">
        {filteredNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-300 dark:text-gray-600 px-6">
            <p className="text-sm text-center">
              {sideSection === 'archived' ? t.noArchived : sideSection === 'todo' ? t.noTodo : sideSection === 'canvas' ? '还没有画布' : sideSection === 'trash' ? '回收站为空' : t.noNotes}
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {sideSection === 'trash' && trashNotes.length > 0 && (
              <button onClick={() => { if (confirm('确定永久删除所有回收站中的笔记？此操作不可恢复。')) emptyTrash(); }}
                className="w-full mb-2 px-3 py-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/10 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition-all">
                清空回收站
              </button>
            )}
            {filteredNotes.map((note) => {
              const isTodo = note.noteType === 'todo' || note.isTodayPlan;
              const isCanvas = note.noteType === 'canvas';
              const allCompleted = isTodo && note.content.trim() && extractTasks(note.content).length > 0 && extractTasks(note.content).every(t => t.checked);
              return (
              <div key={note.id} onClick={() => setActiveNoteId(note.id)} draggable={sideSection !== 'trash'}
                onDragStart={(event) => { event.dataTransfer.setData('application/x-muyujian-note', note.id); event.dataTransfer.effectAllowed = 'copy'; }}
                className={`sidebar-note-card group relative p-3 rounded-xl cursor-pointer transition-all duration-200 ${activeNoteId === note.id
                  ? 'bg-white dark:bg-gray-800 shadow-md shadow-rose-100/50 dark:shadow-gray-900/50 border border-rose-200/60 dark:border-gray-700'
                  : allCompleted
                    ? 'bg-gray-50/80 dark:bg-gray-800/20 border border-transparent opacity-60'
                    : 'bg-transparent hover:bg-white/60 dark:hover:bg-gray-800/40 border border-transparent'}`}>

                {/* 标题行 */}
                <div className="flex items-start justify-between">
                  <h3 className={`text-sm font-medium truncate flex-1 leading-relaxed ${allCompleted ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200'}`}>
                    {(() => {
                      const activeTag = filterTags.length === 1 ? filterTags[0] : null;
                      const isPinnedHere = activeTag
                        ? (note.pinnedInTags || []).includes(activeTag) || note.isPinned
                        : !!note.isPinned;
                      return isPinnedHere ? <span className="text-rose-400 mr-1">📌</span> : null;
                    })()}
                    {note.isTodayPlan && <span className="text-amber-400 mr-1">☆</span>}
                    {isCanvas && <span className="text-indigo-400 mr-1">▦</span>}
                    {searchQuery ? (() => {
                      const q = searchQuery.toLowerCase();
                      const idx = note.title.toLowerCase().indexOf(q);
                      if (idx === -1) return note.title;
                      return <>{note.title.slice(0, idx)}<mark className="bg-amber-200 dark:bg-amber-700 rounded px-0.5">{note.title.slice(idx, idx + q.length)}</mark>{note.title.slice(idx + q.length)}</>;
                    })() : note.title}
                  </h3>
                  {isTodo && (() => {
                    const tasks = extractTasks(note.content);
                    const done = tasks.filter(t => t.checked).length;
                    return tasks.length > 0 ? (
                      <span className={`text-[10px] ml-2 flex-shrink-0 ${allCompleted ? 'text-gray-300 dark:text-gray-600' : 'text-gray-400 dark:text-gray-500'}`}>
                        {done}/{tasks.length}
                      </span>
                    ) : null;
                  })()}
                  {/* 悬浮操作按钮组 */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200 ml-1 flex-shrink-0">
                    {sideSection === 'trash' ? (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); restoreNote(note.id); }}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all"
                          title="恢复">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); if (confirm('永久删除后不可恢复，确定？')) permanentDelete(note.id); }}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                          title="永久删除">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <>
                    {/* 置顶按钮 */}
                    {(() => {
                      const activeTag = filterTags.length === 1 ? filterTags[0] : null;
                      const isPinnedHere = activeTag
                        ? (note.pinnedInTags || []).includes(activeTag) || note.isPinned
                        : !!note.isPinned;
                      return (
                        <button onClick={(e) => {
                          e.stopPropagation();
                          if (activeTag) togglePinInTag(note.id, activeTag);
                          else togglePin(note.id);
                        }}
                          className={`p-1.5 rounded-lg transition-all ${isPinnedHere
                            ? 'text-rose-500 bg-rose-50 dark:bg-rose-900/20'
                            : 'text-gray-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20'}`}
                          title={isPinnedHere ? '取消置顶' : '置顶'}>
                          <svg className="w-3.5 h-3.5" fill={isPinnedHere ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                          </svg>
                        </button>
                      );
                    })()}
                    {!isCanvas && <button onClick={(e) => { e.stopPropagation(); updateNote(note.id, { isTodayPlan: !note.isTodayPlan }); }}
                      className={`p-1.5 rounded-lg transition-all ${note.isTodayPlan
                        ? 'text-amber-500 bg-amber-50 dark:bg-amber-900/20'
                        : 'text-gray-300 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'}`}
                      title={note.isTodayPlan ? t.cancelTodayPlan : t.setTodayPlan}>☆</button>}
                    {!isCanvas && <button onClick={(e) => { e.stopPropagation(); setShowDeadlinePicker(showDeadlinePicker === note.id ? null : note.id); }}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
                      title={t.setDeadline}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </button>}
                    <button onClick={(e) => { e.stopPropagation(); setShowTagInput(showTagInput === note.id ? null : note.id); }}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all"
                      title={t.addTag}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); archiveNote(note.id); }}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all"
                      title={note.isArchived ? t.unarchive : t.archiveIt}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                    </button>
                    <button onClick={(e) => handleDeleteNote(note.id, e)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                      title={t.delete}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                      </>
                    )}
                  </div>
                </div>

                {/* 摘要 */}
                {note.content && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-1 leading-relaxed">{getSummary(note.content)}</p>
                )}
                {isCanvas && <p className="text-xs text-indigo-400/80 dark:text-indigo-300/70 mt-0.5 leading-relaxed">无限画布 · {note.canvasItems?.length || 0} 个元素</p>}

                {/* 标签 */}
                {note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {note.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-rose-50 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400 rounded-md text-[10px]">
                        {tag}
                        <button onClick={(e) => handleRemoveTag(note.id, tag, e)} className="hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* 截止日期倒计时 */}
                {note.deadline && (
                  <div className="mt-1.5">
                    <CountdownBadge deadline={note.deadline} />
                  </div>
                )}

                {/* 标签输入框 */}
                {showTagInput === note.id && (
                  <div className="mt-2 relative" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <input type="text" placeholder={t.tagPlaceholder} value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { handleAddTag(note.id, e); } }}
                        className="flex-1 px-2 py-1 text-xs border border-rose-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-rose-300" autoFocus />
                      <button onClick={(e) => handleAddTag(note.id, e)}
                        className="px-2.5 py-1 text-xs bg-rose-400 text-white rounded-lg hover:bg-rose-500 transition-colors">{t.add}</button>
                    </div>
                    {allTags.filter(tag => !note.tags.includes(tag) && (newTag ? tag.includes(newTag) : true)).length > 0 && (
                      <div className="mt-1 max-h-32 overflow-y-auto bg-white dark:bg-gray-800 border border-rose-100 dark:border-gray-700 rounded-lg shadow-lg">
                        {allTags.filter(tag => !note.tags.includes(tag) && (newTag ? tag.includes(newTag) : true)).map(tag => (
                          <button key={tag} onClick={(e) => {
                            e.stopPropagation();
                            updateNote(note.id, { tags: [...note.tags, tag] });
                            setNewTag('');
                            setShowTagInput(null);
                          }}
                            className="w-full text-left px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-rose-50 dark:hover:bg-gray-700 transition-colors">
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 截止日期选择器 */}
                {showDeadlinePicker === note.id && (
                  <DeadlinePicker
                    deadline={note.deadline}
                    onSelect={(ts) => handleSetDeadline(note.id, ts ? new Date(ts) : null)}
                  />
                )}

                {/* 时间 */}
                <div className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">
                  {sideSection === 'trash' && note.deletedAt
                    ? `删除于 ${formatDate(note.deletedAt)}`
                    : formatDate(note.updatedAt)}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
