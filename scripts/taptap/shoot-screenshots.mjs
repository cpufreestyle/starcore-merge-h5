// 用法: node --experimental-websocket cdp-shots.mjs
// 把真实 Chrome 窗口缩到手机竖屏尺寸,拍 4 张 v1.4.1 游戏截图(无尽/计时/解谜/爆发)。
import process from 'node:process';
import fs from 'node:fs';

const debugUrl = process.argv[2] || 'http://127.0.0.1:49351';
const dir = 'D:/ai share/repo/starcore-merge-h5/store/screenshots/';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const targets = await (await fetch(`${debugUrl}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:8899'))
  || targets.find((t) => t.type === 'page');
if (!page) { console.error('no page target'); process.exit(1); }

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

// 窗口尺寸由启动参数 --window-size 控制(Chrome 152 无 Browser.enable)
await sleep(900);
const vp = await send('Runtime.evaluate', { expression: 'JSON.stringify({ w: innerWidth, h: innerHeight })', returnByValue: true });
console.log('viewport ' + vp.result.value);

const evalJson = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result ? r.result.value : null;
};
const shoot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png', fromSurface: false });
  fs.writeFileSync(dir + name, Buffer.from(s.data, 'base64'));
  console.log('saved ' + name);
};
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const clickMenu = async (mode) => {
  const pos = await evalJson(`(() => {
    const b = document.querySelector('#menuOverlay .btn[data-mode="${mode}"]');
    if (!b) return null;
    b.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`);
  if (!pos) { console.error('menu btn missing: ' + mode); process.exit(1); }
  await sleep(300);
  const p = JSON.parse(pos);
  await clickAt(p.x, p.y);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://localhost:8899/' });
await sleep(3500);

// 1. 无尽
await clickMenu('classic');
await sleep(1500);
await shoot('shot-endless.png');

// 2. 计时
await send('Page.navigate', { url: 'http://localhost:8899/' });
await sleep(3000);
await clickMenu('timed');
await sleep(1800);
await shoot('shot-timed.png');

// 3. 解谜(点开始挑战)
await send('Page.navigate', { url: 'http://localhost:8899/' });
await sleep(3000);
await clickMenu('puzzle');
await sleep(1200);
const startBtn = await evalJson(`(() => {
  const b = [...document.querySelectorAll('button, .btn')].find(x => (x.textContent || '').trim().includes('开始挑战') && x.offsetParent !== null);
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`);
if (startBtn) await clickAt(JSON.parse(startBtn).x, JSON.parse(startBtn).y);
await sleep(1800);
await shoot('shot-puzzle.png');

// 4. 爆发瞬间
await send('Page.navigate', { url: 'http://localhost:8899/' });
await sleep(3000);
await clickMenu('classic');
await sleep(800);
await evalJson(`(() => {
  const mk = (level) => ({ level, born: performance.now() - 1000, pop: 0, rainbow: false });
  const g = [
    [mk(1), mk(1), mk(2), mk(3), mk(2)],
    [mk(3), mk(2), mk(1), mk(2), mk(3)],
    [mk(2), mk(3), mk(4), mk(1), mk(2)],
    [mk(1), mk(2), mk(3), mk(2), mk(1)],
    [mk(4), mk(1), mk(2), mk(3), mk(2)],
  ];
  window.__SC_DEBUG.setGrid(g);
})()`);
await sleep(300);
await evalJson(`window.__SC_DEBUG.doMergeDebug({ r: 0, c: 0 }, { r: 0, c: 1 })`);
await sleep(280);
await shoot('shot-burst.png');

// 恢复窗口大小交给启动参数,脚本结束时无需处理
console.log('all shots done');
ws.close();
process.exit(0);
