// 用法: node --experimental-websocket cdp-click.mjs <triggerIndex>
// 点击素材上传 trigger(视口坐标,基于 getBoundingClientRect)。
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

// 先滚动到 trigger,再用视口坐标点击
const expr = `(() => {
  const trigs = [...document.querySelectorAll('div[class*="_trigger_"]')];
  const t = trigs[${idx}];
  if (!t) return null;
  t.scrollIntoView({ block: 'center', behavior: 'instant' });
  return 'scrolled';
})()`;
await send('Runtime.evaluate', { expression: expr, returnByValue: true });
await sleep(600);

const rect = await send('Runtime.evaluate', {
  expression: `(() => {
    const trigs = [...document.querySelectorAll('div[class*="_trigger_"]')];
    const t = trigs[${idx}];
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`,
  returnByValue: true,
});
if (!rect.result || !rect.result.value) { console.error('trigger not found'); process.exit(1); }
const { x, y } = JSON.parse(rect.result.value);

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 30, y: y - 30, button: 'none' });
await sleep(150);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
await sleep(120);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(80);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
console.log(`clicked trigger ${idx} @ viewport (${Math.round(x)}, ${Math.round(y)})`);
ws.close();
process.exit(0);
