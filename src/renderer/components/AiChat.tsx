import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../utils/markdown';

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; streaming?: boolean; error?: boolean };
type ChatSession = { id: string; title: string; createdAt: number; messages: ChatMessage[] };
type AiConfigSnapshot = { baseUrl: string; model: string; configured: boolean; secureStorageAvailable: boolean };

const SESSIONS_KEY = 'muyujian-ai-chats';

function loadSessions(): ChatSession[] {
  try {
    const value = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter((item: any): item is ChatSession => item && typeof item.id === 'string' && Array.isArray(item.messages))
      .map((session) => ({
        ...session,
        // 重载历史会话时清除残留的 streaming 标记，防止因异常中断的历史消息一直挂着光标
        messages: session.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      }));
  } catch { return []; }
}

function persistSessions(sessions: ChatSession[]): void {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); } catch { /* 超出配额时放弃持久化 */ }
}

/**
 * 与笔记、题册同级的 AI 问答页：直连网关（/chat/completions 流式）。
 * 网关/模型/Key 与 Agent 页共用同一份配置（DeepSeek Harness 的设置里维护），
 * 点右上角设置按钮会跳到 Agent 页并打开其模型配置。
 */
export const AiChat: React.FC = () => {
  const [config, setConfig] = useState<AiConfigSnapshot | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeId, setActiveId] = useState<string | null>(() => loadSessions()[0]?.id ?? null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [knowledgeSources, setKnowledgeSources] = useState<Array<{ id: string; type: string; title: string }>>([]);
  const [knowledgeBundles, setKnowledgeBundles] = useState<Array<{ id: string; name: string; description?: string; sourceIds: string[] }>>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('muyujian-knowledge-selected') || '[]'); } catch { return []; }
  });
  const [selectedBundleIds, setSelectedBundleIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('muyujian-knowledge-bundles-selected') || '[]'); } catch { return []; }
  });
  const [knowledgeTab, setKnowledgeTab] = useState<'sources' | 'bundles'>('bundles');
  const [showKnowledgeDrawer, setShowKnowledgeDrawer] = useState(false);
  const [newBundleName, setNewBundleName] = useState('');
  const [newBundleDesc, setNewBundleDesc] = useState('');
  const [newBundleSelectedSources, setNewBundleSelectedSources] = useState<string[]>([]);
  const [creatingBundle, setCreatingBundle] = useState(false);
  const requestRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const active = useMemo(() => sessions.find((session) => session.id === activeId) ?? null, [sessions, activeId]);
  const messages = active?.messages ?? [];

  const openAgentSettings = () => window.dispatchEvent(new Event('muyujian:open-agent-settings'));

  const refreshConfig = useCallback(() => {
    window.electronAPI?.getAiConfig().then((value) => setConfig(value)).catch(() => setConfig(null));
  }, []);
  useEffect(() => {
    refreshConfig();
    window.addEventListener('muyujian:ai-config-changed', refreshConfig);
    return () => window.removeEventListener('muyujian:ai-config-changed', refreshConfig);
  }, [refreshConfig]);

  
  const refreshBundles = useCallback(() => {
    window.electronAPI?.knowledgeListBundles().then((bundles) => {
      setKnowledgeBundles(bundles || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    window.electronAPI?.knowledgeGetSources().then((sources) => {
      setKnowledgeSources(sources || []);
    }).catch(() => {});
    refreshBundles();
  }, [refreshBundles]);

  useEffect(() => {
    try { localStorage.setItem('muyujian-knowledge-bundles-selected', JSON.stringify(selectedBundleIds)); } catch {}
  }, [selectedBundleIds]);

  useEffect(() => {
    try { localStorage.setItem('muyujian-knowledge-selected', JSON.stringify(selectedSourceIds)); } catch {}
  }, [selectedSourceIds]);

  useEffect(() => { persistSessions(sessions); }, [sessions]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);

  const patchActive = (updater: (messages: ChatMessage[]) => ChatMessage[]) => {
    // 必须在调用点快照 sessionId：updater 由 React 延迟执行，
    // done 分支在 patch 后会清空 requestRef，届时再读会拿不到会话 id
    const targetSessionId = requestRef.current?.split('::')[1];
        setSessions((current) => current.map((session) =>
      session.id === targetSessionId
        ? { ...session, messages: updater(session.messages) }
        : session));
  };

  // 订阅 AI 流式输出；requestId 前缀里带会话 id，确保只更新发起请求的会话
  useEffect(() => {
    return window.electronAPI?.onAiStream((event) => {
      // requestRef 存的是 `${requestId}::${sessionId}`（sessionId 用来定位要更新的会话）
            if (event.requestId !== requestRef.current?.split('::')[0]) {
                return;
      }
      patchActive((list) => {
        const next = list.map((message, index) => {
          if (index !== list.length - 1 || message.role !== 'assistant') return message;
          if (event.delta) return { ...message, content: message.content + event.delta };
          if (event.done) {
                        return { ...message, streaming: false, error: Boolean(event.error), content: event.error || message.content || '' };
          }
          return message;
        });
        return next;
      });
      if (event.done) { requestRef.current = null; setBusy(false); }
    });
  }, []);

  const createSession = useCallback(() => {
    if (busy) return;
    const session: ChatSession = { id: `chat-${Date.now().toString(36)}`, title: '新对话', createdAt: Date.now(), messages: [] };
    setSessions((current) => [session, ...current]);
    setActiveId(session.id);
    setInput('');
  }, [busy]);

  const removeSession = useCallback((id: string) => {
    if (busy) return;
    if (!confirm('删除这条对话记录？')) return;
    setSessions((current) => {
      const next = current.filter((session) => session.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }, [activeId, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    let session = active;
    if (!session) {
      session = { id: `chat-${Date.now().toString(36)}`, title: text.slice(0, 24), createdAt: Date.now(), messages: [] };
      setSessions((current) => [session!, ...current]);
      setActiveId(session.id);
    }
    setInput('');
    setBusy(true);
    requestRef.current = `local::${session.id}`;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text };
    const reply: ChatMessage = { id: `ai-${Date.now()}`, role: 'assistant', content: '', streaming: true };
    setSessions((current) => current.map((item) => item.id === session!.id
      ? { ...item, title: item.messages.length ? item.title : text.slice(0, 24), messages: [...item.messages, userMessage, reply] }
      : item));
    try {
      const history = session.messages.slice(-6).map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`).join('\n\n');
      const content = history ? `${history}\n\n用户：${text}` : text;
      const result = await window.electronAPI?.startAi({
        action: 'chat',
        content,
        knowledgeSourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
        knowledgeBundleIds: selectedBundleIds.length ? selectedBundleIds : undefined,
      });
      if (!result?.success || !result.requestId) throw new Error(result?.error || '无法启动 AI 请求');
      requestRef.current = `${result.requestId}::${session.id}`;
    } catch (error) {
      requestRef.current = null;
      setSessions((current) => current.map((item) => item.id === session!.id
        ? { ...item, messages: item.messages.map((message, index) =>
            index === item.messages.length - 1 ? { ...message, streaming: false, error: true, content: error instanceof Error ? error.message : 'AI 请求失败' } : message) }
        : item));
      setBusy(false);
    }
  }, [active, busy, input]);

  const cancel = useCallback(() => {
    const id = requestRef.current?.split('::')[0];
    if (id && !id.startsWith('local')) void window.electronAPI?.cancelAi(id);
  }, []);

  const select = (id: string) => { if (!busy) setActiveId(id); };

  const hints = useMemo(() => [
    '帮我把这段话讲得更好理解一些：…',
    '给我出 3 道题检查我是否理解了上面的概念',
    '这段笔记有哪些可以追问下去的问题？',
  ], []);

  return <>
    <div className="ai-chat-shell">
      <aside className="ai-chat-sidebar">
        <div className="ai-chat-sidebar-head">
          <h2>历史对话</h2>
          <button onClick={createSession} disabled={busy} title="新建对话">＋</button>
        </div>
        {sessions.length ? sessions.map((session) => (
          <div key={session.id} className={`ai-chat-session ${session.id === activeId ? 'active' : ''}`}>
            <button onClick={() => select(session.id)} title={session.title}>
              <strong>{session.title}</strong>
              <small>{session.messages.length} 条 · {new Date(session.createdAt).toLocaleDateString('zh-CN')}</small>
            </button>
            <i onClick={() => removeSession(session.id)} role="button" aria-label="删除对话" title="删除对话">×</i>
          </div>
        )) : <p className="ai-chat-sidebar-empty">还没有对话，点上方 ＋ 开始。</p>}
      </aside>

      <section className="ai-chat-main">
        <header className="ai-chat-main-head">
          <span className="ai-chat-title">{active?.title || '新对话'}</span>
          <div className="ai-chat-head-actions">
            {config && <span className={`ai-status ${config.configured ? 'ok' : 'off'}`}>{config.configured ? `已连接 · ${config.model}` : '未配置'}</span>}
            <button className={`ai-knowledge-button ${selectedSourceIds.length ? 'active' : ''}`} onClick={() => setShowKnowledgeDrawer(!showKnowledgeDrawer)} title="挂载知识库数据源">
              📚 知识库{(selectedBundleIds.length > 0 || selectedSourceIds.length > 0) && (
                <span className="knowledge-badge">
                  {selectedBundleIds.length > 0 ? `包:${selectedBundleIds.length} ` : ''}
                  {selectedSourceIds.length > 0 ? `单:${selectedSourceIds.length}` : ''}
                </span>
              )}
            </button>
            <button className="ai-settings-button" onClick={openAgentSettings} title="AI 接口设置（与 Agent 共用，跳转到 Agent 页配置）" aria-label="AI 接口设置">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3m0 12v3M3 12h3m12 0h3m-4.2-6.8l-2.1 2.1m-7.4 7.4l-2.1 2.1m0-11.6l2.1 2.1m7.4 7.4l2.1 2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" /></svg>
            </button>
          </div>
        </header>

        
        {showKnowledgeDrawer && (
          <div className="ai-knowledge-drawer">
            <div className="ai-knowledge-tabs">
              <button
                className={`ai-knowledge-tab-btn ${knowledgeTab === 'bundles' ? 'active' : ''}`}
                onClick={() => setKnowledgeTab('bundles')}
              >
                📦 知识库大包 (Bundles)
              </button>
              <button
                className={`ai-knowledge-tab-btn ${knowledgeTab === 'sources' ? 'active' : ''}`}
                onClick={() => setKnowledgeTab('sources')}
              >
                📑 单项来源 ({knowledgeSources.length})
              </button>
              <div style={{ flex: 1 }} />
              <button className="mini close" onClick={() => setShowKnowledgeDrawer(false)}>×</button>
            </div>

            {knowledgeTab === 'bundles' ? (
              <div className="ai-bundle-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)' }}>
                    勾选打包知识库，提问时将同时检索包内所有资料：
                  </span>
                  {!creatingBundle && (
                    <button className="primary mini" onClick={() => { setCreatingBundle(true); setNewBundleSelectedSources([]); }}>
                      + 打包新知识库
                    </button>
                  )}
                </div>

                {creatingBundle && (
                  <div className="ai-bundle-create-box">
                    <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 6 }}>新建多来源知识库包</div>
                    <div className="ai-bundle-form-row">
                      <input
                        className="ai-bundle-input"
                        placeholder="知识库包名称（如：数学一真题与错题集）"
                        value={newBundleName}
                        onChange={(e) => setNewBundleName(e.target.value)}
                      />
                      <input
                        className="ai-bundle-input"
                        placeholder="描述（可选）"
                        value={newBundleDesc}
                        onChange={(e) => setNewBundleDesc(e.target.value)}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary, #6b7280)', marginBottom: 4 }}>
                      选择要归纳打包的笔记、题册或文件：
                    </div>
                    <div className="ai-bundle-source-select">
                      {knowledgeSources.map((s) => {
                        const isIncluded = newBundleSelectedSources.includes(s.id);
                        return (
                          <label key={s.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={isIncluded}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setNewBundleSelectedSources([...newBundleSelectedSources, s.id]);
                                } else {
                                  setNewBundleSelectedSources(newBundleSelectedSources.filter((id) => id !== s.id));
                                }
                              }}
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.title}>
                              {s.type === 'note' ? '📝' : s.type === 'questionBook' ? '📖' : '📄'} {s.title}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="secondary mini" onClick={() => setCreatingBundle(false)}>取消</button>
                      <button
                        className="primary mini"
                        disabled={!newBundleName.trim() || newBundleSelectedSources.length === 0}
                        onClick={async () => {
                          if (!newBundleName.trim()) return;
                          await window.electronAPI?.knowledgeSaveBundle({
                            name: newBundleName.trim(),
                            description: newBundleDesc.trim(),
                            sourceIds: newBundleSelectedSources,
                          });
                          setNewBundleName('');
                          setNewBundleDesc('');
                          setNewBundleSelectedSources([]);
                          setCreatingBundle(false);
                          refreshBundles();
                        }}
                      >
                        保存打包 ({newBundleSelectedSources.length} 项)
                      </button>
                    </div>
                  </div>
                )}

                <div className="ai-bundle-list">
                  {knowledgeBundles.length === 0 ? (
                    <div className="ai-knowledge-empty">暂无知识库包，点击上方「+ 打包新知识库」可将多个笔记/题册/文件合并打包。</div>
                  ) : (
                    knowledgeBundles.map((b) => {
                      const checked = selectedBundleIds.includes(b.id);
                      return (
                        <div key={b.id} className="ai-bundle-item">
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedBundleIds([...selectedBundleIds, b.id]);
                                } else {
                                  setSelectedBundleIds(selectedBundleIds.filter((id) => id !== b.id));
                                }
                              }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>📦 {b.name}</span>
                                <span style={{ fontSize: 11, fontWeight: 'normal', color: 'var(--text-secondary, #6b7280)' }}>
                                  ({b.sourceIds.length} 个来源)
                                </span>
                              </div>
                              {b.description && (
                                <div style={{ fontSize: 11, color: 'var(--text-secondary, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {b.description}
                                </div>
                              )}
                            </div>
                          </label>
                          <button
                            className="mini"
                            style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                            onClick={async () => {
                              if (confirm(`确认删除知识库包「${b.name}」吗？（不会删除原始内容）`)) {
                                await window.electronAPI?.knowledgeDeleteBundle(b.id);
                                setSelectedBundleIds(selectedBundleIds.filter((id) => id !== b.id));
                                refreshBundles();
                              }
                            }}
                          >
                            删除
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div>
                <div className="ai-knowledge-drawer-head" style={{ padding: '0 0 6px 0' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)' }}>单个来源独立勾选：</span>
                  <div className="ai-knowledge-drawer-btns">
                    <button className="mini" onClick={() => setSelectedSourceIds(knowledgeSources.map((s) => s.id))}>全选</button>
                    <button className="mini" onClick={() => setSelectedSourceIds([])}>清空</button>
                  </div>
                </div>
                <div className="ai-knowledge-source-list">
                  {knowledgeSources.length === 0 ? (
                    <p className="ai-knowledge-empty">暂无可用来源（可在便签中记录、导入题册或在工作区 knowledge/ 放置文件）。</p>
                  ) : (
                    knowledgeSources.map((source) => {
                      const checked = selectedSourceIds.includes(source.id);
                      const typeLabel = source.type === 'note' ? '📝 笔记' : source.type === 'questionBook' ? '📖 题册' : '📄 文件';
                      return (
                        <label key={source.id} className="ai-knowledge-item">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSourceIds([...selectedSourceIds, source.id]);
                              } else {
                                setSelectedSourceIds(selectedSourceIds.filter((id) => id !== source.id));
                              }
                            }}
                          />
                          <span className="type-badge">{typeLabel}</span>
                          <span className="source-title" title={source.title}>{source.title}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="ai-chat-list" ref={listRef}>
          {!messages.length && <div className="ai-chat-empty">
            <p>{config?.configured ? '直接向 AI 提问，或从下面挑一个开场。' : <>需要自主调用工具的复杂任务，请去旁边的「Agent」页。先在右上角配置 AI 接口。</>}</p>
            <div>{hints.map((hint) => <button key={hint} onClick={() => setInput(hint)}>{hint}</button>)}</div>
          </div>}
          {messages.map((message) => <div key={message.id} className={`ai-chat-message ${message.role} ${message.error ? 'error' : ''}`}>
            <span className="ai-chat-role">{message.role === 'user' ? '我' : 'AI'}</span>
            {message.role === 'user'
              ? <p>{message.content}</p>
              : <div className="ai-chat-content" dangerouslySetInnerHTML={{ __html: message.content ? renderMarkdown(message.content) : (message.streaming ? '<p class="muted">正在思考…</p>' : '') }} />}
            {message.streaming && <i className="ai-chat-cursor" aria-label="生成中" />}
          </div>)}
        </div>

        <div className="ai-chat-input">
          <textarea
            value={input}
            rows={3}
            placeholder={config?.configured ? '输入问题，Enter 发送，Shift+Enter 换行' : '请先在右上角配置 AI 接口（跳转 Agent 页）'}
            disabled={!config?.configured}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
            aria-label="消息输入框"
          />
          <div className="ai-chat-send">
            {busy ? <button className="secondary-mini" onClick={cancel}>停止</button> : <button className="primary" disabled={!config?.configured || !input.trim()} onClick={() => void send()}>发送</button>}
          </div>
        </div>
      </section>
    </div>
  </>;
};
