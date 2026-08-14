import { create } from 'zustand';
import { generateId } from '../utils/markdown';

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
  createdAt: number;
}

interface AttachmentStore {
  attachments: Attachment[];
  loaded: boolean;
  loadAttachments: () => Promise<void>;
  addAttachment: (file: File, dataUrl: string) => Attachment;
  removeAttachment: (id: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(attachments: Attachment[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = JSON.stringify(attachments);
    if (window.electronAPI?.saveAttachments) window.electronAPI.saveAttachments(data);
    else localStorage.setItem('muyujian-attachments', data);
  }, 250);
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
      set({ attachments: Array.isArray(attachments) ? attachments.filter((item): item is Attachment =>
        item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.dataUrl === 'string'
      ) : [], loaded: true });
    } catch {
      set({ attachments: [], loaded: true });
    }
  },
  addAttachment: (file, dataUrl) => {
    const attachment: Attachment = { id: generateId(), name: file.name, mimeType: file.type, dataUrl, size: file.size, createdAt: Date.now() };
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
