// 等待素材库弹窗出现"已选 N"后点击"确认选择",失败自动用新坐标重试。
import process from 'node:process';

const debugUrl = 'http://127.0.0.1:49351';
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
const evalJson = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result ? r.result.value : null;
};

// 1. 等"已选"出现(最多 20s)
let selected = false;
for (let i = 0; i < 40 && !selected; i++) {
  await sleep(500);
  selected = await evalJson("(() => { const m = [...document.querySelectorAll('.ant-modal')].filter(n => n.offsetParent !== null)[0]; return m ? /已选\\s*\\d/.test(m.textContent || '') : false; })()");
}
console.log('selected=' + selected);
if (!selected) { console.error('upload did not register a selection'); process.exit(2); }
await sleep(800); // 等布局稳定

// 2. 点确认(最多重试 4 次,每次重新取坐标)
for (let attempt = 1; attempt <= 4; attempt++) {
  const pos = await evalJson(`(() => {
    const btns = [...document.querySelectorAll('.ant-modal button')].filter(b => b.offsetParent !== null);
    const b = btns.find(x => (x.textContent || '').replace(/\\s+/g, '').includes('确认选择'));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`);
  if (!pos) { console.error('确认选择 not found'); process.exit(3); }
  const { x, y } = JSON.parse(pos);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  console.log(`attempt ${attempt}: clicked @ (${Math.round(x)}, ${Math.round(y)})`);
  await sleep(1800);
  const closed = await evalJson("(() => [...document.querySelectorAll('.ant-modal')].filter(n => n.offsetParent !== null).length === 0)");
  if (closed) { console.log('modal-closed=true'); ws.close(); process.exit(0); }
  console.log('modal still open, retrying...');
}
console.log('modal-closed=false');
ws.close();
process.exit(4);
