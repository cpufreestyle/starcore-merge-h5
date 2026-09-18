// 用法: node --experimental-websocket shoot-screenshots.mjs [debugUrl]
// 拍 4 张 v1.4.1 游戏截图(无尽/计时/解谜/爆发)。
// 要点: 用 Emulation 模拟 720x1280 竖屏布局 + captureBeyondViewport 抓完整帧;
//       Chrome 152 无 Browser.enable,窗口尺寸用启动参数 --window-size 控制。
import process from 'node:process';
import fs from 'node:fs';

const debugUrl = process.argv[2] || 'http://127.0.0.1:49352';
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
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result ? r.result.value : null;
};
const ver = await (await fetch(`${debugUrl}/json/version`)).json();
const headless = /HeadlessChrome/i.test(ver['User-Agent'] || '');
const shoot = async (name) => {
  // 无头浏览器必须从 surface 抓帧;有头浏览器 fromSurface:false 才能绕开合成器冻结帧
  const s = await send('Page.captureScreenshot', { format: 'png', fromSurface: headless });
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
const rectOf = (expr) => ev(`(() => { const b = ${expr}; if (!b) return null; b.scrollIntoView({block:'center',behavior:'instant'}); const r = b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`);
const startMode = async (mode) => {
  // 纯 JS 游戏,直接触发 DOM click(设备模拟下 CDP 鼠标事件坐标不可靠)
  const ok = await ev(`(() => {
    const b = document.querySelector('#menuOverlay .btn[data-mode="${mode}"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!ok) { console.error('menu btn missing: ' + mode); process.exit(1); }
  await sleep(1300);
  const started = await ev(`(() => { const m = document.getElementById('menuOverlay'); return !!(m && m.classList.contains('hidden')); })()`);
  console.log('mode ' + mode + ' started=' + started);
  // 关掉首次进入的"怎么玩"教程弹窗
  const dismissed = await ev(`(() => {
    const words = ['开始游戏', '知道了', '我明白了', '关闭', '继续', '好的'];
    const b = [...document.querySelectorAll('button, .btn')].find((x) => {
      if (x.offsetParent === null) return false;
      const t = (x.textContent || '').trim();
      return words.some((w) => t === w || t.includes(w));
    });
    if (!b) return null;
    b.click();
    return b.textContent.trim();
  })()`);
  if (dismissed) { console.log('dismissed: ' + dismissed); await sleep(700); }
};

await send('Page.enable');
await send('Runtime.enable');
// 无头 Chrome 下窗口即视口,dsf=1 → 输出 720x1280
await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 1280, deviceScaleFactor: 1, mobile: true });

const load = async () => {
  await send('Page.navigate', { url: 'http://localhost:8899/' });
  await sleep(3200);
};

// 1. 无尽
await load();
await startMode('classic');
await sleep(1200);
await shoot('shot-endless.png');

// 2. 计时
await load();
await startMode('timed');
await sleep(1600);
await shoot('shot-timed.png');

// 3. 解谜
await load();
await startMode('puzzle');
await sleep(900);
await ev(`(() => {
  const b = [...document.querySelectorAll('button, .btn')].find(x => (x.textContent||'').trim().includes('开始挑战') && x.offsetParent !== null);
  if (b) b.click();
})()`);
await sleep(1600);
await shoot('shot-puzzle.png');

// 4. 爆发瞬间
await load();
await startMode('classic');
await sleep(700);
await ev(`(() => {
  const mk = (level) => ({ level, born: performance.now() - 1000, pop: 0, rainbow: false });
  window.__SC_DEBUG.setGrid([
    [mk(1), mk(1), mk(2), mk(3), mk(2)],
    [mk(3), mk(2), mk(1), mk(2), mk(3)],
    [mk(2), mk(3), mk(4), mk(1), mk(2)],
    [mk(1), mk(2), mk(3), mk(2), mk(1)],
    [mk(4), mk(1), mk(2), mk(3), mk(2)],
  ]);
})()`);
await sleep(300);
await ev(`window.__SC_DEBUG.doMergeDebug({ r: 0, c: 0 }, { r: 0, c: 1 })`);
await sleep(280);
await shoot('shot-burst.png');

await send('Emulation.clearDeviceMetricsOverride');
console.log('all shots done');
ws.close();
process.exit(0);
