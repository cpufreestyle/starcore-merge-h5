// 用法: node --experimental-websocket record-gameplay.mjs [debugUrl] [outName]
// 在页面内录制 720x1280 竖屏实机视频:合成画布 = 棋盘 canvas + 实时 HUD 文字/底块,
// MediaRecorder 输出 MP4(avc1),经本地 serve.mjs 的 POST /save 回传到 store/。
import process from 'node:process';

const debugUrl = process.argv[2] || 'http://127.0.0.1:49353';
const outName = process.argv[3] || 'gameplay-portrait-v1.4.1.mp4';

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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result ? r.result.value : null;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 1280, deviceScaleFactor: 1, mobile: true });
// 防止页面被判为后台而节流帧产生
try { await send('Page.setWebLifecycleState', { state: 'active' }); } catch (_) {}
try { await send('Page.bringToFront'); } catch (_) {}
await send('Page.navigate', { url: 'http://localhost:8899/' });
await sleep(3200);

// 开始经典模式 + 关教程
await ev(`(() => { const b = document.querySelector('#menuOverlay .btn[data-mode="classic"]'); if (b) b.click(); })()`);
await sleep(1300);
await ev(`(() => {
  const words = ['开始游戏', '知道了', '我明白了'];
  const b = [...document.querySelectorAll('button, .btn')].find((x) => x.offsetParent !== null && words.some((w) => (x.textContent || '').includes(w)));
  if (b) b.click();
})()`);
await sleep(900);

// 页面内:启动合成录制
const started = await ev(`(() => {
  const board = document.getElementById('board');
  const comp = document.createElement('canvas');
  comp.width = 720; comp.height = 1280;
  const cg = comp.getContext('2d');
  window.__recComp = comp;

  const visible = (el) => el.offsetParent !== null;
  const skip = (el) => el.closest('#boardWrap') || el.closest('.overlay') || el === comp;
  const roundRectPath = (g, x, y, w, h, r) => {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };

  function _draw() {
    cg.fillStyle = '#0b0b1f';
    cg.fillRect(0, 0, 720, 1280);
    // 棋盘
    const br = board.getBoundingClientRect();
    cg.drawImage(board, br.x, br.y, br.width, br.height);
    // HUD 底块(工具按钮/能量条等有背景色的元素)
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || skip(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.width > 640 && r.height > 1000) continue; // 整页容器跳过
      const st = getComputedStyle(el);
      if (!st.backgroundColor || st.backgroundColor === 'rgba(0, 0, 0, 0)') continue;
      cg.fillStyle = st.backgroundColor;
      roundRectPath(cg, r.x, r.y, r.width, r.height, parseFloat(st.borderRadius) || 0);
      cg.fill();
    }
    // HUD 文字(叶子节点)
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || skip(el) || el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (!t) continue;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      cg.font = st.fontStyle + ' ' + st.fontWeight + ' ' + parseFloat(st.fontSize) + 'px ' + st.fontFamily;
      cg.fillStyle = st.color;
      cg.textAlign = 'center';
      cg.textBaseline = 'middle';
      cg.fillText(t, r.x + r.width / 2, r.y + r.height / 2);
    }
  }
  let frames = 0;
  function draw() { frames++; window.__recFrames = frames; _draw(); }
  function frame() { draw(); requestAnimationFrame(frame); }
  frame();
  // rAF 在被节流的环境下不可靠,定时器兜底保证帧率
  if (window.__recTimer) clearInterval(window.__recTimer);
  window.__recTimer = setInterval(draw, 33);

  // 手动逐帧推送: captureStream(0)+requestFrame 避免编码器按实时性丢帧(否则视频时长偏短)
  const stream = comp.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E') ? 'video/mp4;codecs=avc1.42E01E' : 'video/webm';
  window.__chunks = [];
  window.__rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5000000 });
  window.__rec.ondataavailable = (e) => { if (e.data && e.data.size) window.__chunks.push(e.data); };
  window.__rec.start(250);

  window.__recStop = false;
  let f = 0;
  (function pump() {
    if (window.__recStop) return;
    _draw();
    try { track.requestFrame(); } catch (_) {}
    f++; window.__recFrames = f;
    setTimeout(pump, 100);
  })();
  return mime;
})()`);
console.log('recorder mime=' + started);

// 驱动 8 次合并(每次挑一对相邻同色核心)
for (let i = 0; i < 8; i++) {
  const merged = await ev(`(() => {
    const g = window.__SC_DEBUG.getGrid();
    const pairs = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      const v = g[r][c];
      if (!v) continue;
      if (c < 4 && g[r][c+1] && g[r][c+1].level === v.level) pairs.push([{ r, c }, { r, c: c + 1 }]);
      if (r < 4 && g[r+1][c] && g[r+1][c].level === v.level) pairs.push([{ r, c }, { r: r + 1, c }]);
    }
    if (!pairs.length) return false;
    const p = pairs[Math.floor(Math.random() * pairs.length)];
    window.__SC_DEBUG.doMergeDebug(p[0], p[1]);
    return true;
  })()`);
  if (!merged) { await ev(`window.__SC_DEBUG.newGame('classic')`); }
  await sleep(2300);
}

// 停止并回传
const info = await ev(`(async () => {
  window.__recStop = true;
  const rec = window.__rec;
  const t0 = performance.now();
  const done = new Promise((res) => { rec.onstop = res; });
  rec.stop();
  await done;
  const blob = new Blob(window.__chunks, { type: rec.mimeType.split(';')[0] });
  const resp = await fetch('http://localhost:8899/save?name=${outName}', { method: 'POST', body: blob });
  return JSON.stringify({ size: blob.size, type: blob.type, frames: window.__recFrames, recMs: Math.round(performance.now() - t0), save: await resp.text() });
})()`);
console.log('result=' + info);

await send('Emulation.clearDeviceMetricsOverride');
ws.close();
process.exit(0);
