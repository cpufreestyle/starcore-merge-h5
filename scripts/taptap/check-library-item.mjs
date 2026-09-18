// 用法: node --experimental-websocket cdp-checkitem.mjs <序号>
// 点击素材库弹窗中第 N 个网格项的勾选框(CDP 真鼠标事件)。
import process from 'node:process';

const debugUrl = 'http://127.0.0.1:49351';
const idx = Number(process.argv[2] || 0);

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
  const modal = [...document.querySelectorAll('.ant-modal')].filter(n => n.offsetParent !== null)[0];
  if (!modal) return null;
  const cbs = [...modal.querySelectorAll('.ant-checkbox')].filter(c => c.offsetParent !== null);
  const c = cbs[${idx}];
  if (!c) return JSON.stringify({ err: 'not-found', count: cbs.length });
  const r = c.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, count: cbs.length });
})()`;

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
if (!r.result || !r.result.value) { console.error('no modal/checkbox'); process.exit(1); }
const v = JSON.parse(r.result.value);
if (v.err) { console.error('checkbox not-found, count=' + v.count); process.exit(1); }
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v.x, y: v.y, button: 'none' });
await sleep(120);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: v.x, y: v.y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(80);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: v.x, y: v.y, button: 'left', buttons: 0, clickCount: 1 });
console.log(`clicked checkbox #${idx} @ (${Math.round(v.x)}, ${Math.round(v.y)}) of ${v.count}`);
ws.close();
process.exit(0);
