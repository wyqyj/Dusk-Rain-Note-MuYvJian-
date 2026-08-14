import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Note } from '../store/noteStore';

export const CommandPalette: React.FC<{ notes: Note[]; onClose: () => void; onOpenNote: (id: string) => void; onNewNote: () => void; onNewCanvas: () => void; onTogglePreview: () => void; onOpenAssets: () => void; onOpenAppearance: () => void }> = (props) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const actions = [
    { label: '新建便签', hint: '创建 Markdown 笔记', run: props.onNewNote },
    { label: '新建画布', hint: '开始空间化整理', run: props.onNewCanvas },
    { label: '切换预览渲染', hint: '显示或关闭实时预览', run: props.onTogglePreview },
    { label: '打开素材库', hint: '管理并复用图片素材', run: props.onOpenAssets },
    { label: '外观与壁纸', hint: '上传、清除本地壁纸', run: props.onOpenAppearance },
  ].filter((action) => `${action.label}${action.hint}`.toLowerCase().includes(query.toLowerCase()));
  const matches = useMemo(() => props.notes.filter((note) => !note.isDeleted && `${note.title} ${note.content} ${(note.canvasItems || []).map((item) => item.content).join(' ')}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8), [props.notes, query]);
  const run = (action: () => void) => { action(); props.onClose(); };
  return <div className="overlay-panel command-overlay" role="dialog" aria-modal="true" onMouseDown={props.onClose}><div className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
    <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') props.onClose(); }} placeholder="搜索笔记或输入操作…" aria-label="命令搜索" />
    <div className="command-section"><span>操作</span>{actions.map((action) => <button key={action.label} onClick={() => run(action.run)}><b>{action.label}</b><small>{action.hint}</small></button>)}</div>
    <div className="command-section"><span>笔记与画布</span>{matches.length ? matches.map((note) => <button key={note.id} onClick={() => run(() => props.onOpenNote(note.id))}><b>{note.noteType === 'canvas' ? '▦ ' : note.noteType === 'todo' ? '☆ ' : ''}{note.title}</b><small>{note.noteType === 'canvas' ? `${note.canvasItems?.length || 0} 个元素` : note.content.replace(/\n+/g, ' ').slice(0, 58) || '空笔记'}</small></button>) : <p>没有匹配结果</p>}</div>
  </div></div>;
};
