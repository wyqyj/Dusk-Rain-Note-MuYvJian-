// 监听 dsh webview 的 console / 异常 / 日志并刷新页面（排障用）
// 用法: node scripts/cdp-console.mjs [targetType]
const targetType = process.argv[2] || 'webview';
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const t = list.find((x) => x.type === targetType);
if (!t) { console.error('no target of type', targetType); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    const args = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    console.log(`[console.${m.params.type}]`, args);
  } else if (m.method === 'Runtime.exceptionThrown') {
    console.log('[EXCEPTION]', JSON.stringify(m.params.exceptionDetails).slice(0, 800));
  } else if (m.method === 'Log.entryAdded') {
    console.log('[log]', m.params.entry.level, m.params.entry.text.slice(0, 400));
  }
};
send('Runtime.enable');
send('Log.enable');
send('Page.enable');
if (!process.argv.includes('--no-reload')) send('Page.reload');
setTimeout(() => process.exit(0), 15000);
