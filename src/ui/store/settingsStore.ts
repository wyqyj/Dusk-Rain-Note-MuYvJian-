import { create } from 'zustand';
import { TextMode, texts, Texts } from '../utils/i18n';
import { getBridge } from '../../platform/container';

interface Settings {
  theme: 'light' | 'dark';
  textMode: TextMode;
  quickNoteShortcut: string;
  autoSaveInterval: number;
  wallpaper?: string;
  onboardingCompleted?: boolean;
}

interface SettingsStore {
  settings: Settings;
  t: Texts;
  updateSettings: (updates: Partial<Settings>) => void;
  toggleTheme: () => void;
  toggleTextMode: () => void;
}

const defaultSettings: Settings = { theme: 'light', textMode: 'modern', quickNoteShortcut: 'Alt+Q', autoSaveInterval: 60 };

function loadSettings(): Settings {
  // 统一读取桥的 KV 通道（web/capacitor 均为 localStorage，保证跨平台一致）
  try {
    const data = localStorage.getItem('lingxi-settings');
    const parsed = data ? JSON.parse(data) : {};
    return { theme: parsed.theme || defaultSettings.theme, textMode: parsed.textMode || defaultSettings.textMode,
      quickNoteShortcut: parsed.quickNoteShortcut || defaultSettings.quickNoteShortcut,
      autoSaveInterval: parsed.autoSaveInterval || defaultSettings.autoSaveInterval,
      wallpaper: typeof parsed.wallpaper === 'string' ? parsed.wallpaper : undefined,
      onboardingCompleted: parsed.onboardingCompleted === true };
  } catch { return defaultSettings; }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSettings(settings: Settings): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('lingxi-settings', JSON.stringify(settings)); } catch {}
  }, 300);
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: loadSettings(),
  t: texts[loadSettings().textMode] || texts.modern,

  updateSettings: (updates) => {
    const prev = get().settings;
    const updated = { ...prev, ...updates };
    set({ settings: updated, t: texts[updated.textMode] || texts.modern });
    saveSettings(updated);
    const bridge = getBridge();
    bridge.kv.saveSettings(updated);
    if (updated.theme !== prev.theme) {
      bridge.kv.updateTheme(updated.theme);
      document.documentElement.classList.toggle('dark', updated.theme === 'dark');
    }
  },

  toggleTheme: () => {
    const current = get().settings.theme;
    get().updateSettings({ theme: current === 'light' ? 'dark' : 'light' });
  },

  toggleTextMode: () => {
    const current = get().settings.textMode;
    get().updateSettings({ textMode: current === 'modern' ? 'classical' : 'modern' });
  },
}));
