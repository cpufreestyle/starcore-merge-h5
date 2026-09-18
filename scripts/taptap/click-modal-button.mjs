// 用法: node --experimental-websocket cdp-clicktext.mjs <文本> [序号]
// 点击弹窗内包含指定文本的第 N 个可见按钮(CDP 真鼠标事件)。
import process from 'node:process';

const debugUrl = 'http://127.0.0.1:49351';
const text = process.argv[2];
const idx = Number(process.argv[3] || 0);
if (!text) { console.error('need text'); process.exit(1); }

const targets = await (await fetch(`${debugUrl}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('/store/update'));
if (!page) { console.error('store/update page not found'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const expr = `(() => {
  const btns = [...document.querySelectorAll('.ant-modal button')].filter(b => b.offsetParent !== null);
  const hits = btns.filter(b => (b.textContent || '').replace(/\\s+/g, '').includes('${text}'));
  const b = hits[${idx}];
  if (!b) return JSON.stringify({ err: 'not-found', count: hits.length });
  const r = b.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, count: hits.length });
})()`;

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
const v = JSON.parse(r.result.value);
if (v.err) { console.error(`确认按钮未找到 (${text})`); process.exit(1); }
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v.x, y: v.y, button: 'none' });
await sleep(120);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: v.x, y: v.y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(80);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: v.x, y: v.y, button: 'left', buttons: 0, clickCount: 1 });
console.log(`clicked '${text}' #${idx} @ (${Math.round(v.x)}, ${Math.round(v.y)}) of ${v.count}`);
ws.close();
process.exit(0);
