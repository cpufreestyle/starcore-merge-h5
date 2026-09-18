// 用法: node --experimental-websocket cdp-triggers.cjs
// 枚举当前所有上传 trigger 及其区块标签。
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

const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const trigs = [...document.querySelectorAll('div[class*="_trigger_"]')];
    return JSON.stringify(trigs.map((t, i) => {
      let label = '?';
      for (let p = t; p; p = p.parentElement) {
        const m = (p.textContent || '').match(/(游戏图标|16:9 \\u00b7|1:1 \\u00b7|游戏截图|宣传图)/);
        if (m) { label = m[0]; break; }
      }
      return i + '=' + label;
    }));
  })()`,
  returnByValue: true,
});
console.log(r.result.value);
ws.close();
process.exit(0);
