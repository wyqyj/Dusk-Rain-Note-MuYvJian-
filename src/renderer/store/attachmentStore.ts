import { create } from 'zustand';
import { generateId } from '../utils/markdown';
import { attachmentTokenToUrl, ATTACHMENT_TOKEN_PREFIX } from '../utils/attachmentRef';

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  /** attachments/ 目录下的文件名；老数据可能只有 dataUrl */
  fileName?: string;
  dataUrl?: string;
  size: number;
  createdAt: number;
}

interface AttachmentStore {
  attachments: Attachment[];
  loaded: boolean;
  loadAttachments: () => Promise<void>;
  addAttachment: (file: File) => Promise<Attachment>;
  removeAttachment: (id: string) => void;
}

/** 素材的可渲染 URL：文件优先，老数据回退到 dataURI。 */
export function attachmentDisplayUrl(attachment: Attachment | undefined): string {
  if (!attachment) return '';
  if (attachment.fileName) return attachmentTokenToUrl(ATTACHMENT_TOKEN_PREFIX + attachment.fileName);
  return attachment.dataUrl || '';
}

async function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 把正文落到 attachments/ 目录；无桌面环境时回退为 dataURI。 */
async function storeAttachmentContent(file: File): Promise<{ fileName?: string; dataUrl?: string }> {
  const dataUrl = await readAsDataUrl(file);
  if (window.electronAPI?.writeAttachmentFile) {
    const result = await window.electronAPI.writeAttachmentFile(file.name, dataUrl);
    if (result.success && result.fileName) return { fileName: result.fileName };
  }
  return { dataUrl };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedJson = '';

function persist(attachments: Attachment[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = JSON.stringify(attachments);
    if (data === lastSavedJson) return;
    lastSavedJson = data;
    if (window.electronAPI?.saveAttachments) void window.electronAPI.saveAttachments(data).catch(() => {});
    else {
      try { localStorage.setItem('muyujian-attachments', data); } catch {}
    }
  }, 500);
}

export const useAttachmentStore = create<AttachmentStore>((set, get) => ({
  attachments: [],
  loaded: false,
  loadAttachments: async () => {
    try {
      const raw = window.electronAPI?.getAttachments
        ? await window.electronAPI.getAttachments()
        : localStorage.getItem('muyujian-attachments') || '[]';
      const attachments = JSON.parse(raw);
      const valid: Attachment[] = Array.isArray(attachments) ? attachments.filter((item: any): item is Attachment =>
        item && typeof item.id === 'string' && typeof item.name === 'string' &&
        (typeof item.dataUrl === 'string' || typeof item.fileName === 'string')
      ) : [];
      set({ attachments: valid, loaded: true });
      lastSavedJson = JSON.stringify(valid);
      // 惰性迁移：老数据中的 dataURI 素材逐个落盘，成功后更新记录
      void migrateLegacyAttachments(valid);
    } catch {
      set({ attachments: [], loaded: true });
    }
  },
  addAttachment: async (file) => {
    const stored = await storeAttachmentContent(file);
    const attachment: Attachment = { id: generateId(), name: file.name, mimeType: file.type, ...stored, size: file.size, createdAt: Date.now() };
    const attachments = [attachment, ...get().attachments];
    set({ attachments });
    persist(attachments);
    return attachment;
  },
  removeAttachment: (id) => {
    const attachments = get().attachments.filter((attachment) => attachment.id !== id);
    set({ attachments });
    persist(attachments);
  },
}));

/** 启动后逐个把 dataURI 素材迁移为磁盘文件，再持久化一次清单。 */
async function migrateLegacyAttachments(attachments: Attachment[]): Promise<void> {
  if (!window.electronAPI?.writeAttachmentFile) return;
  let changed = false;
  for (const attachment of attachments) {
    if (!attachment.dataUrl || attachment.fileName) continue;
    try {
      const result = await window.electronAPI.writeAttachmentFile(attachment.name, attachment.dataUrl);
      if (result.success && result.fileName) {
        attachment.fileName = result.fileName;
        delete attachment.dataUrl;
        changed = true;
      }
    } catch { /* 保留原样，下次启动再试 */ }
  }
  if (changed) {
    useAttachmentStore.setState({ attachments: [...attachments] });
    persist(attachments);
  }
}
