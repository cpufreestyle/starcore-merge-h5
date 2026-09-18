// 用法: node --experimental-websocket cdp-clickpage.mjs <文本> [序号]
// 在整个页面查找可见按钮(不限弹窗),真鼠标点击第 N 个。
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
  const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
  const hits = btns.filter(b => (b.textContent || '').replace(/\\s+/g, '').includes('${text}'));
  const b = hits[${idx}];
  if (!b) return JSON.stringify({ err: 'not-found', count: hits.length });
  b.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = b.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, count: hits.length });
})()`;

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
const v = JSON.parse(r.result.value);
if (v.err) { console.error(`not-found (${text}), count=${v.count}`); process.exit(1); }
await sleep(500);
const r2 = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
const v2 = JSON.parse(r2.result.value);
if (v2.err) { console.error('not-found after scroll'); process.exit(1); }
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v2.x, y: v2.y, button: 'none' });
await sleep(120);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: v2.x, y: v2.y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(80);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: v2.x, y: v2.y, button: 'left', buttons: 0, clickCount: 1 });
console.log(`clicked '${text}' @ (${Math.round(v2.x)}, ${Math.round(v2.y)})`);
ws.close();
process.exit(0);
