import React, { useCallback, useEffect, useRef, useState } from 'react';

type AgentConfirmRequest = { id: string; capability: string; description: string; params: Record<string, unknown> };
type WebviewLike = HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> };

/**
 * Agent 一级页：整页内嵌 DeepSeek Harness 完整 Web GUI（看板 / 会话 / 插件 / 模型配置）。
 * - AI 助手页点「接口设置」会跳转到这里，并自动打开 GUI 内的模型设置（事件：muyujian:open-agent-settings）。
 * - GUI 与应用共用 DSH_HOME：这里改的网关/模型/Key，AI 助手问答直接复用。
 */
export const AgentView: React.FC = () => {
  const [agentUrl, setAgentUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [pendingConfirms, setPendingConfirms] = useState<AgentConfirmRequest[]>([]);
  const webviewRef = useRef<WebviewLike | null>(null);
  const [settingsRequested, setSettingsRequested] = useState(false);
  const [preset, setPreset] = useState<'muyujian' | 'research'>(() => {
    return (localStorage.getItem('muyujian-dsh-preset') as any) || 'muyujian';
  });
  const [switching, setSwitching] = useState(false);


  const switchPreset = useCallback(async (nextPreset: 'muyujian' | 'research') => {
    if (nextPreset === preset || switching) return;
    setSwitching(true);
    setPreset(nextPreset);
    localStorage.setItem('muyujian-dsh-preset', nextPreset);
    setAgentUrl(null);
    setError(null);
    try {
      const res = await window.electronAPI?.dshWebRestart(nextPreset);
      if (!res?.success) {
        setError(res?.error || '切换预设失败');
      } else {
        const started = await window.electronAPI?.dshWebStart(nextPreset);
        if (started?.success && started.url) setAgentUrl(started.url);
        else setError(started?.error || '启动新预设失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换预设异常');
    } finally {
      setSwitching(false);
    }
  }, [preset, switching]);

  const boot = useCallback(() => {
    if (agentUrl || booting) return;
    setBooting(true);
    setError(null);
    window.electronAPI?.dshWebStart(preset).then((result) => {
      if (result?.success && result.url) setAgentUrl(result.url);
      else setError(result?.error || 'Agent 启动失败');
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Agent 启动失败');
    }).finally(() => setBooting(false));
  }, [agentUrl, booting]);

  useEffect(() => { boot(); }, [boot]);

  const resolveConfirm = useCallback((request: AgentConfirmRequest, approved: boolean) => {
    setPendingConfirms((list) => list.filter((item) => item.id !== request.id));
    void window.electronAPI?.dshAgentConfirmResolve({ id: request.id, approved });
  }, []);
  useEffect(() => window.electronAPI?.onDshAgentConfirmRequest((request) => {
    setPendingConfirms((list) => list.some((item) => item.id === request.id) ? list : [...list, request]);
  }), []);

  // 「配置 API」跳转：标记待打开设置；webview 就绪后在 GUI 里点设置按钮
  useEffect(() => {
    const onOpenSettings = () => setSettingsRequested(true);
    window.addEventListener('muyujian:open-agent-settings', onOpenSettings);
    return () => window.removeEventListener('muyujian:open-agent-settings', onOpenSettings);
  }, []);

  useEffect(() => {
    if (!settingsRequested || !agentUrl) return;
    const view = webviewRef.current;
    if (!view) return;
    let cancelled = false;
    let attempts = 0;
    const tryOpen = () => {
      if (cancelled) return;
      attempts += 1;
      // dsh Web GUI 的设置入口是右上角的设置按钮（aria-label 为“设置”/Settings）
      view.executeJavaScript?.(`(() => {
        const button = [...document.querySelectorAll('button')].find((el) =>
          /^(设置|Settings|Preferences)$/i.test(el.getAttribute('aria-label') || el.title || el.textContent?.trim() || ''));
        if (button) { button.click(); return true; }
        return false;
      })()`).then((clicked) => {
        if (clicked) setSettingsRequested(false);
        else if (attempts < 12) setTimeout(tryOpen, 800);
        else setSettingsRequested(false);
      }).catch(() => { if (attempts < 12) setTimeout(tryOpen, 800); else setSettingsRequested(false); });
    };
    // webview 首次加载需要时间，稍等 GUI 骨架渲染完再点
    const timer = setTimeout(tryOpen, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [settingsRequested, agentUrl]);

  return <div className="agent-view">

    <div className="agent-preset-bar">
      <div className="agent-preset-segmented">
        <button
          className={`preset-btn ${preset === 'muyujian' ? 'active' : ''}`}
          onClick={() => switchPreset('muyujian')}
          disabled={switching || booting}
          title="暮雨笺考研备考预设：专注管理便签、题册、计划与知识检索"
        >
          暮雨笺预设
        </button>
        <button
          className={`preset-btn ${preset === 'research' ? 'active' : ''}`}
          onClick={() => switchPreset('research')}
          disabled={switching || booting}
          title="学术研究预设：专注深度文献分析、著作研读与交叉检索"
        >
          研究预设
        </button>
      </div>
      {switching && <span className="agent-preset-switching">正在切换运行时预设…</span>}
    </div>

    <div className="agent-view-stage">
      {agentUrl ? (
        <webview ref={webviewRef as React.Ref<HTMLWebViewElement>} src={agentUrl} className="agent-webview" allowpopups={false}></webview>
      ) : error ? (
        <div className="agent-view-state error">
          <p>{error}</p>
          <button className="secondary-mini" onClick={boot}>重试</button>
        </div>
      ) : (
        <div className="agent-view-state"><p className="muted">正在启动内置 Agent（DeepSeek Harness 完整版）…</p></div>
      )}
    </div>
    {pendingConfirms.length > 0 && <div className="agent-confirm-stack">
      {pendingConfirms.map((request) => (
        <div key={request.id} className="ai-confirm-card" role="alertdialog" aria-label="Agent 写操作确认">
          <div className="ai-confirm-head">
            <strong>{request.description || request.capability}</strong>
            <span className="ai-confirm-cap">{request.capability}</span>
          </div>
          {Object.keys(request.params || {}).length > 0 && (
            <pre className="ai-confirm-params">{JSON.stringify(request.params, null, 2)}</pre>
          )}
          <div className="ai-confirm-actions">
            <button className="secondary-mini" onClick={() => resolveConfirm(request, false)}>拒绝</button>
            <button className="primary" onClick={() => resolveConfirm(request, true)}>同意执行</button>
          </div>
        </div>
      ))}
    </div>}
  </div>;
};
