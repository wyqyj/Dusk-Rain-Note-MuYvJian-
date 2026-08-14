import React, { useRef } from 'react';
import { useSettingsStore } from '../store/settingsStore';

export const AppearancePanel: React.FC<{ onClose: () => void; previewVisible: boolean; onTogglePreview: () => void }> = ({ onClose, previewVisible, onTogglePreview }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { settings, updateSettings } = useSettingsStore();
  const upload = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) { alert('壁纸图片不能超过 8MB'); return; }
    const reader = new FileReader();
    reader.onload = () => updateSettings({ wallpaper: String(reader.result) });
    reader.readAsDataURL(file);
  };
  return <div className="overlay-panel" role="dialog" aria-modal="true"><div className="version-panel appearance-panel"><div className="overlay-header"><div><h2>外观与预览</h2><p>壁纸仅保存在本机，可随时清除</p></div><button className="icon-mini" onClick={onClose} title="关闭" aria-label="关闭">×</button></div>
    <div className="appearance-content"><section><div><strong>自定义壁纸</strong><p>{settings.wallpaper ? '已应用一张本地壁纸' : '上传图片作为工作区背景'}</p></div><div className="appearance-buttons"><button className="primary-mini" onClick={() => inputRef.current?.click()}>上传壁纸</button>{settings.wallpaper && <button className="secondary-mini" onClick={() => updateSettings({ wallpaper: undefined })}>清除</button>}</div></section><section><div><strong>实时预览</strong><p>可在编辑时手动关闭渲染窗格</p></div><button className="secondary-mini" onClick={onTogglePreview}>{previewVisible ? '关闭预览' : '显示预览'}</button></section></div>
    <input ref={inputRef} className="hidden" type="file" accept="image/*" onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }} />
  </div></div>;
};
