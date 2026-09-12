// 通过 CDP 在暮雨笺 dev 窗口里执行一段 JS（用于 UI 自动化验证）
const expr = process.argv[2];
// 可选第 2 个参数：目标类型，默认主页面，可传 webview 选 dsh GUI guest
const targetType = process.argv[3] || 'page';
if (!expr) { console.error('usage: node scripts/cdp-eval.mjs "<js expression>"'); process.exit(1); }

const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = list.find((t) => t.type === targetType);
if (!page) { console.error('no page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

const result = await new Promise((resolve, reject) => {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === 1) resolve(msg.result);
  };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
});
ws.close();
console.log(JSON.stringify(result?.result?.value ?? result, null, 2));
