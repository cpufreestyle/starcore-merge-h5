#!/usr/bin/env node
// 打 TapTap H5 包:zip 内必须使用正斜杠路径、显式目录条目、UTF-8 文件名标志,
// 否则 TapTap 解析会报"压缩包根目录包含 N 个文件或目录"。
// 结构对齐已过审的 v1.4.1 包:单一根目录 starcoremerge/,不含 APK/视频/宣传图大图。
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const PREFIX = 'starcoremerge/';
const FILES = [
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/ads.js',
  'js/audio.js',
  'js/game.js',
  'js/shop.js',
  'store/feature-1024x500.png',
  'store/icon-72.png',
  'store/icon-96.png',
  'store/icon-144.png',
  'store/icon-192.png',
  'store/icon-512.png',
];
const DIRS = ['starcoremerge/', 'starcoremerge/css/', 'starcoremerge/js/', 'starcoremerge/store/'];

const outArgIdx = process.argv.indexOf('--out');
const outPath = outArgIdx > -1 && process.argv[outArgIdx + 1]
  ? resolve(process.argv[outArgIdx + 1])
  : join(root, `starcore-merge-h5-taptap-v${version}.zip`);

for (const f of FILES) {
  if (!existsSync(join(root, f))) {
    console.error(`[build-taptap] 缺少文件: ${f}`);
    process.exit(1);
  }
}

// ---- zip 写入(零依赖) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

const UTF8_FLAG = 0x0800;

function localHeader(name, { crc, csize, usize, method, time, date }) {
  const nameBuf = Buffer.from(name, 'utf8');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(UTF8_FLAG, 6);
  h.writeUInt16LE(method, 8);
  h.writeUInt16LE(time, 10);
  h.writeUInt16LE(date, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(csize, 18);
  h.writeUInt32LE(usize, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28); // extra len
  return Buffer.concat([h, nameBuf]);
}

function centralHeader(name, offset, attrs, { crc, csize, usize, method, time, date }) {
  const nameBuf = Buffer.from(name, 'utf8');
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4); // version made by
  h.writeUInt16LE(20, 6); // version needed
  h.writeUInt16LE(UTF8_FLAG, 8);
  h.writeUInt16LE(method, 10);
  h.writeUInt16LE(time, 12);
  h.writeUInt16LE(date, 14);
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(csize, 20);
  h.writeUInt32LE(usize, 24);
  h.writeUInt16LE(nameBuf.length, 28);
  h.writeUInt32LE(attrs, 38); // external attrs: 0x10 = MS-DOS 目录位
  h.writeUInt32LE(offset, 42);
  return Buffer.concat([h, nameBuf]);
}

function eocd(entryCount, cdSize, cdOffset) {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(0x06054b50, 0);
  h.writeUInt16LE(entryCount, 8);
  h.writeUInt16LE(entryCount, 10);
  h.writeUInt32LE(cdSize, 12);
  h.writeUInt32LE(cdOffset, 16);
  return h;
}

// ---- 打包 ----
const { time, date } = dosDateTime();
const chunks = [];
 const centrals = [];
let offset = 0;

function pushEntry(name, data, method, attrs) {
  const crc = data.length ? crc32(data) : 0;
  let payload = data;
  let csize = data.length;
  if (method === 8) {
    payload = zlibDeflateRaw(data);
    csize = payload.length;
  }
  const meta = { crc, csize, usize: data.length, method, time, date };
  const local = localHeader(name, meta);
  chunks.push(local, payload);
  centrals.push(centralHeader(name, offset, attrs, meta));
  offset += local.length + payload.length;
}

import { deflateRawSync } from 'node:zlib';
const zlibDeflateRaw = (buf) => deflateRawSync(buf);

for (const d of DIRS) pushEntry(d, Buffer.alloc(0), 0, 0x10);
for (const f of FILES) {
  const data = readFileSync(join(root, f));
  pushEntry(PREFIX + f, data, 8, 0);
}

const cdBuf = Buffer.concat(centrals);
chunks.push(cdBuf, eocd(centrals.length, cdBuf.length, offset));

const zip = Buffer.concat(chunks);
writeFileSync(outPath, zip);

const kb = (statSync(outPath).size / 1024).toFixed(1);
console.log(`[build-taptap] v${version} -> ${outPath}`);
console.log(`[build-taptap] ${centrals.length} 个条目, ${kb} KB`);
