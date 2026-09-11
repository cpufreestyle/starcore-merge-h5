/**
 * 合成星核 H5 — 服务器入口
 *
 * 启动：npm start（生产）| npm run dev（开发，允许模拟支付）
 * 默认端口 3000，通过 .env 的 PORT 覆盖
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const compression = require('compression');

const app = express();
app.set('trust proxy', true);

// CORS：仅允许 H5_ORIGIN 显式声明的来源（逗号分隔），未声明的跨域来源一律不放行
const origins = config.h5Origin.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: origins }));

// 部署层 gzip/brotli：对文本类响应（HTML/JS/CSS/JSON）按 Accept-Encoding 自动协商压缩
app.use(compression());

// 部署层安全响应头（基础加固）
// 注意：这些头仅作用于由本服务托管的 web 分发；Android 壳走本地 file:// 不受影响。
app.use((req, res, next) => {
  // 禁止浏览器对响应 MIME 做嗅探（防 MIME 嗅探型 XSS）
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Referrer 仅在同源或同安全级别时携带，避免跨站泄露完整路径
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // 基础 CSP：默认仅自身；放行内联脚本/样式（index.html 含 AD_CONFIG 等内联逻辑）
  // 与 https 第三方（优量汇/穿山甲广告 SDK 会注入脚本、建立连接，并可能用到 eval/wasm）。
  // 这是“不破坏广告”的宽松配置；若要更强防护可改为 nonce 方案（需改 index.html 与 SDK 接入）。
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' https:; " +
    "frame-src 'self' https:; " +
    "media-src 'self' data: https:;");
  // HSTS：仅当经反向代理以 HTTPS 访问时下发，避免纯 HTTP 部署被锁死
  const proto = req.headers['x-forwarded-proto'];
  if (req.secure || proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

// 保留原始 body 供微信回调验签/解密
app.use(express.json({
  limit: '100kb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// 业务路由
app.use('/api/order', require('./routes/orders'));
app.use('/api/coins', require('./routes/coins'));
app.use('/api/notify', require('./routes/notify'));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: require('../package.json').version, dev: config.isDev });
});

// 部署层缓存策略：
// - 文本类静态资源（js/css/manifest）允许客户端缓存 5 分钟并按 ETag 重校验，发版后最多 5 分钟生效；
//   因资源 URL 未做内容哈希，故用 must-revalidate 兜底一致性，避免长期脏缓存。
// - index.html 与 service worker 始终重校验，保证发版即时生效、SW 不被旧缓存卡住。
const STATIC_CACHE = 'public, max-age=300, must-revalidate';
function setStaticHeaders(res) {
  res.setHeader('Cache-Control', STATIC_CACHE);
}
const staticOpts = { maxAge: 300 * 1000, etag: true, setHeaders: setStaticHeaders };

// 托管 H5 静态资源（仅游戏本体，不暴露仓库根目录的安装包等文件）
const h5Root = path.join(__dirname, '..');
app.use('/css', express.static(path.join(h5Root, 'css'), staticOpts));
app.use('/js', express.static(path.join(h5Root, 'js'), staticOpts));
app.get('/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', STATIC_CACHE);
  res.sendFile(path.join(h5Root, 'manifest.json'));
});
// service worker：PWA 在 web 分发下由本服务直接托管，必须始终重校验
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(h5Root, 'sw.js'));
});
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(h5Root, 'index.html'));
});

// API 404 与错误兜底
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  if (res.headersSent) return next(err);
  const status = err.type === 'entity.parse.failed' ? 400 : 500;
  res.status(status).json({ error: 'internal error' });
});

app.listen(config.port, () => {
  console.log(`[Server] StarCore server listening on :${config.port} (${config.isDev ? 'dev' : config.nodeEnv})`);
  if (config.isDev) {
    console.log('[Server] Dev mode: POST /api/order/simulate-pay 可用');
  }
});
