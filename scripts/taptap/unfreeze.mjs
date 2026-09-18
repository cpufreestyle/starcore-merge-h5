// 清理 chooser 拦截残留并强制出帧:禁用 setInterceptFileChooserDialog,再截图对比。
import process from 'node:process';
import fs from 'node:fs';

const debugUrl = 'http://127.0.0.1:49351';
const out = process.argv[2] || 'D:/ai share/repo/starcore-merge-h5/.playwright-cli/unfreeze.png';

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

await send('Page.enable');
await send('Page.setInterceptFileChooserDialog', { enabled: false });
console.log('interception disabled');
await send('Page.bringToFront');
await sleep(500);
// 强制重绘:轻微滚动
await send('Runtime.evaluate', { expression: 'window.scrollBy(0, 1); window.scrollBy(0, -1);' });
await sleep(800);
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: false });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved ' + out);
ws.close();
process.exit(0);
