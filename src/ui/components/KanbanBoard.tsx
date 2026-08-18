import React, { useMemo, useState } from 'react';
import { Note, useNoteStore } from '../store/noteStore';
import { extractTasks } from '../../core/utils/markdown';
import { useUIStore } from '../store/uiStore';

const columns: { id: 'todo' | 'doing' | 'done'; label: string; hint: string }[] = [
  { id: 'todo', label: '待处理', hint: '尚未开始' },
  { id: 'doing', label: '进行中', hint: '正在推进' },
  { id: 'done', label: '已完成', hint: '已交付或归档' },
];

const KanbanCard: React.FC<{ note: Note; onOpen: () => void }> = ({ note, onOpen }) => {
  const tasks = extractTasks(note.content);
  const done = tasks.filter((task) => task.checked).length;
  return <article draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-muyujian-kanban', note.id); event.dataTransfer.effectAllowed = 'move'; }} onDoubleClick={onOpen} className="kanban-card">
    <div className="kanban-card-title">{note.title}</div>
    <p>{note.content.replace(/[#*\[\]`~>_-]/g, '').replace(/\n+/g, ' ').slice(0, 90) || '双击打开并添加任务'}</p>
    <footer>{tasks.length ? <span>{done}/{tasks.length} 项</span> : <span>无子任务</span>}{note.deadline && <span>{new Date(note.deadline).toLocaleDateString('zh-CN')}</span>}</footer>
  </article>;
};

export const KanbanBoard: React.FC = () => {
  const { notes, updateNote, setActiveNoteId } = useNoteStore();
  const { setShowKanban } = useUIStore();
  const [dragging, setDragging] = useState<string | null>(null);
  const todoNotes = useMemo(() => notes.filter((note) => (note.noteType === 'todo' || note.isTodayPlan) && !note.isDeleted && !note.isArchived), [notes]);

  const move = (status: 'todo' | 'doing' | 'done', event: React.DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('application/x-muyujian-kanban');
    if (id) updateNote(id, { kanbanStatus: status, isTodayPlan: status !== 'done' });
    setDragging(null);
  };

  return <div className="kanban-shell">
    <header className="kanban-header"><div><h1>任务看板</h1><p>拖动卡片更新任务状态，双击回到原始待办</p></div><button onClick={() => setShowKanban(false)} title="关闭看板" aria-label="关闭看板">×</button></header>
    <div className="kanban-columns">{columns.map((column) => {
      const cards = todoNotes.filter((note) => (note.kanbanStatus || 'todo') === column.id);
      return <section key={column.id} className={`kanban-column ${dragging ? 'dragging' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => move(column.id, event)}>
        <header><div><h2>{column.label}</h2><span>{column.hint}</span></div><b>{cards.length}</b></header>
        <div className="kanban-list">{cards.map((note) => <div key={note.id} onDragStart={() => setDragging(note.id)} onDragEnd={() => setDragging(null)}><KanbanCard note={note} onOpen={() => { setActiveNoteId(note.id); setShowKanban(false); }} /></div>)}</div>
      </section>;
    })}</div>
  </div>;
};
