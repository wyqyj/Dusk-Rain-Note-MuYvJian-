import React, { useCallback, useEffect, useState } from 'react';

type BridgeInfo = Awaited<ReturnType<NonNullable<typeof window.electronAPI>['getAgentBridge']>>;

/** 设置页“对外接入 Agent”面板：开关本地桥服务、管理令牌、查看最近调用。 */
export function AgentBridgePanel(): React.ReactElement {
  const [info, setInfo] = useState<BridgeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const data = await window.electronAPI?.getAgentBridge();
    if (data) setInfo(data);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (patch: { enabled?: boolean; bind?: 'loopback' | 'lan' }) => {
    if (!info) return;
    setBusy(true);
    setNotice('');
    const result = await window.electronAPI?.saveAgentBridge({
      enabled: patch.enabled ?? info.enabled,
      bind: patch.bind ?? info.bind,
    });
    if (result && !result.success) setNotice(`保存失败：${result.error || '未知错误'}`);
    await refresh();
    setBusy(false);
  };

  const onToggle = (enabled: boolean) => { void save({ enabled }); };

  const onBindChange = (bind: 'loopback' | 'lan') => {
    if (bind === 'lan' && !window.confirm('“局域网可访问”会让同一网络下的其他设备也能连上桥服务（仍需令牌）。确定要继续吗？')) return;
    void save({ bind });
  };

  const copyToken = async () => {
    if (!info?.token) return;
    try {
      await navigator.clipboard.writeText(info.token);
      setNotice('令牌已复制。请妥善保管，它等同于对桥服务的完全访问权限。');
    } catch {
      setNotice('复制失败，请手动选择复制。');
    }
  };

  const resetToken = async () => {
    if (!window.confirm('重新生成后，旧的令牌立即失效，已配置的 Agent 需要更新令牌。继续吗？')) return;
    const result = await window.electronAPI?.resetAgentBridgeToken();
    if (!result?.success) setNotice(`重新生成失败：${result?.error || '未知错误'}`);
    await refresh();
  };

  return <section className="panel">
    <h2>对外接入 Agent</h2>
    <p className="muted">开启后，本机会运行一个本地桥服务，Codex、WorkBuddy 等 Agent 工具可通过它操作暮雨笺：新建笔记、导入题册、调整计划等。只允许白名单能力，不开放删除数据、导出备份或读取 AI Key。</p>
    <div className="inline-actions">
      <label className="toggle"><input type="checkbox" checked={Boolean(info?.enabled)} disabled={busy} onChange={(event) => onToggle(event.target.checked)} /> 启用本地桥</label>
      <select value={info?.bind ?? 'loopback'} disabled={busy || !info} onChange={(event) => onBindChange(event.target.value as 'loopback' | 'lan')}>
        <option value="loopback">仅本机（127.0.0.1）</option>
        <option value="lan">局域网可访问（0.0.0.0）</option>
      </select>
    </div>
    {info?.status?.running && <p className="muted">桥服务地址：<code>{info.status.url}</code></p>}
    {info && info.token ? <>
      <div className="inline-actions">
        <button disabled={busy} onClick={copyToken}>复制令牌</button>
        <button disabled={busy} onClick={resetToken}>重新生成令牌</button>
      </div>
      <p className="muted">令牌：<code>{info.token.slice(0, 8)}…{info.token.slice(-4)}</code>（仅展示片段，点“复制令牌”获取完整值）</p>
    </> : null}
    {notice && <p className="muted">{notice}</p>}
    {info && info.audit.length > 0 && <>
      <h3>最近调用</h3>
      <ul className="audit-list">
        {[...info.audit].reverse().map((line, index) => <li key={index}><code>{line}</code></li>)}
      </ul>
    </>}
  </section>;
}
