import React from 'react';
import { Note, useNoteStore } from '../store/noteStore';

export const VersionHistory: React.FC<{ note: Note; onClose: () => void }> = ({ note, onClose }) => {
  const { restoreVersion } = useNoteStore();
  const versions = [...(note.history || [])].reverse();
  return <div className="overlay-panel" role="dialog" aria-modal="true"><div className="version-panel">
    <div className="overlay-header"><div><h2>版本历史</h2><p>自动保留最近 20 个编辑快照</p></div><button className="icon-mini" onClick={onClose} title="关闭" aria-label="关闭">×</button></div>
    <div className="version-list">{versions.length ? versions.map((version) => <article key={version.id} className="version-row"><div><strong>{new Date(version.savedAt).toLocaleString('zh-CN')}</strong><p>{version.title} · {(version.canvasItems?.length || 0) > 0 ? `${version.canvasItems?.length} 个画布元素` : version.content.replace(/\n+/g, ' ').slice(0, 70) || '空内容'}</p></div><button onClick={() => { restoreVersion(note.id, version.id); onClose(); }}>恢复</button></article>) : <div className="library-empty">此笔记还没有可恢复的历史版本。编辑后会自动创建快照。</div>}</div>
  </div></div>;
};
