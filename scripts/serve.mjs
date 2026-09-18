#!/usr/bin/env node
// 本地静态服务器(零依赖):调试 H5 页面用,替代 npx http-server(免网络下载)。
// 用法: node scripts/serve.mjs [端口]  默认 8080;响应带 no-cache 与 CORS 头。
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    // 开发辅助: POST /save?name=xxx 把请求体写入 store/(页面内录制的视频经此回传)
    if (req.method === 'POST' && req.url.startsWith('/save')) {
      const name = (new URL(req.url, 'http://x').searchParams.get('name') || '').replace(/[^\w.\-]/g, '');
      if (!name) { res.writeHead(400).end('bad name'); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      await writeFile(join(root, 'store', name), body);
      console.log(`[serve] saved store/${name} (${body.length} bytes)`);
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }).end('ok');
      return;
    }
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const st = await stat(file).catch(() => null);
    if (!st || st.isDirectory()) {
      res.writeHead(404).end('Not Found');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  } catch {
    res.writeHead(500).end('Internal Error');
  }
});

server.listen(port, () => {
  console.log(`[serve] http://localhost:${port}/  (root: ${root})`);
});
