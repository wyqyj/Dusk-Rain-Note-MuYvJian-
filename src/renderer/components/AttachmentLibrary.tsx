import React, { useRef } from 'react';
import { Attachment, useAttachmentStore } from '../store/attachmentStore';

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const AttachmentLibrary: React.FC<{ onClose: () => void; onSelect?: (attachment: Attachment) => void }> = ({ onClose, onSelect }) => {
  const { attachments, addAttachment, removeAttachment } = useAttachmentStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.size > 8 * 1024 * 1024) continue;
      addAttachment(file, await readFile(file));
    }
  };

  return (
    <div className="overlay-panel" role="dialog" aria-modal="true">
      <div className="attachment-library">
        <div className="overlay-header">
          <div><h2>素材库</h2><p>图片与附件会保存在本地，可直接放入画布</p></div>
          <div className="overlay-actions">
            <button className="primary-mini" onClick={() => inputRef.current?.click()}>导入图片</button>
            <button className="icon-mini" onClick={onClose} title="关闭" aria-label="关闭">×</button>
          </div>
        </div>
        <input ref={inputRef} className="hidden" type="file" accept="image/*" multiple onChange={(event) => { void addFiles(event.target.files); event.target.value = ''; }} />
        {attachments.length ? <div className="attachment-grid">
          {attachments.map((attachment) => <div className="attachment-tile" key={attachment.id}>
            <button className="attachment-image" onClick={() => onSelect?.(attachment)} title={onSelect ? '放入画布' : attachment.name}>
              <img src={attachment.dataUrl} alt={attachment.name} />
            </button>
            <div className="attachment-meta"><span title={attachment.name}>{attachment.name}</span><button onClick={() => removeAttachment(attachment.id)} title="移除素材" aria-label="移除素材">×</button></div>
          </div>)}
        </div> : <div className="library-empty">素材库还是空的。导入图片后可在任意画布中复用。</div>}
      </div>
    </div>
  );
};
