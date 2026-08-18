import React, { useRef, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { getBridge } from '../../platform/container';

export const AppearancePanel: React.FC<{ onClose: () => void; previewVisible: boolean; onTogglePreview: () => void }> = ({ onClose, previewVisible, onTogglePreview }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [resetting, setResetting] = useState(false);
  const [dataBusy, setDataBusy] = useState<'idle' | 'backup' | 'restore'>('idle');
  const { settings, updateSettings } = useSettingsStore();
  const upload = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) { alert('壁纸图片不能超过 8MB'); return; }
    const reader = new FileReader();
    reader.onload = () => updateSettings({ wallpaper: String(reader.result) });
    reader.readAsDataURL(file);
  };
  const resetWorkspace = async () => {
    if (resetting) return;
    const confirmation = prompt('初始化会删除当前工作台的全部数据和工作台内备份，且不可恢复。请输入“初始化”继续：');
    if (confirmation === null) return;
    if (confirmation.trim() !== '初始化') { alert('输入内容不正确，初始化已取消。'); return; }
    setResetting(true);
    try {
      const result = await getBridge().workspace.resetWorkspace();
      if (!result?.success) { alert(`初始化失败：${result?.error || '未知错误'}`); setResetting(false); return; }
      localStorage.removeItem('lingxi-settings');
      window.location.reload();
    } catch (error) {
      setResetting(false);
      alert(`初始化失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const backupData = async () => {
    if (dataBusy !== 'idle') return;
    setDataBusy('backup');
    try {
      const result = await getBridge().workspace.backupWorkspace();
      if (!result?.success && result?.error && result.error !== '已取消分享' && result.error !== 'cancelled') {
        alert(`备份失败：${result.error || '未知错误'}`);
      }
    } finally { setDataBusy('idle'); }
  };
  const restoreData = async () => {
    if (dataBusy !== 'idle') return;
    if (!confirm('恢复备份会用备份文件覆盖当前的便签、附件与学习工作台数据，继续？')) return;
    setDataBusy('restore');
    try {
      const result = await getBridge().workspace.restoreWorkspace();
      if (result?.success) { alert(`已恢复 ${result.files ?? 0} 个文件，即将重新加载…`); window.location.reload(); }
      else if (result?.error && result.error !== 'cancelled' && result.error !== '已取消分享') alert(`恢复失败：${result.error || '未知错误'}`);
    } finally { setDataBusy('idle'); }
  };
  return <div className="overlay-panel" role="dialog" aria-modal="true"><div className="version-panel appearance-panel"><div className="overlay-header"><div><h2>外观与预览</h2><p>壁纸仅保存在本机，可随时清除</p></div><button className="icon-mini" onClick={onClose} title="关闭" aria-label="关闭">×</button></div>
    <div className="appearance-content"><section><div><strong>自定义壁纸</strong><p>{settings.wallpaper ? '已应用一张本地壁纸' : '上传图片作为工作区背景'}</p></div><div className="appearance-buttons"><button className="primary-mini" onClick={() => inputRef.current?.click()}>上传壁纸</button>{settings.wallpaper && <button className="secondary-mini" onClick={() => updateSettings({ wallpaper: undefined })}>清除</button>}</div></section><section><div><strong>实时预览</strong><p>可在编辑时手动关闭渲染窗格</p></div><button className="secondary-mini" onClick={onTogglePreview}>{previewVisible ? '关闭预览' : '显示预览'}</button></section><section><div><strong>数据备份与恢复</strong><p>导出综合备份（含便签、附件与学习工作台数据），或从备份文件恢复</p></div><div className="appearance-buttons"><button className="primary-mini" disabled={dataBusy !== 'idle'} onClick={backupData}>{dataBusy === 'backup' ? '备份中…' : '导出综合备份'}</button><button className="secondary-mini" disabled={dataBusy !== 'idle'} onClick={restoreData}>{dataBusy === 'restore' ? '恢复中…' : '导入恢复'}</button></div></section><section className="appearance-reset"><div><strong>初始化全部数据</strong><p>删除便签、附件、学习工作台数据和工作台内备份，保留数据目录位置。</p></div><button className="secondary-mini danger-action" disabled={resetting} onClick={resetWorkspace}>{resetting ? '正在初始化…' : '初始化'}</button></section></div>
    <input ref={inputRef} className="hidden" type="file" accept="image/*" onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }} />
  </div></div>;
};
