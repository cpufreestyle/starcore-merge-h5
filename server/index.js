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

const app = express();
app.set('trust proxy', true);

// CORS：仅允许 H5_ORIGIN 显式声明的来源（逗号分隔），未声明的跨域来源一律不放行
const origins = config.h5Origin.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: origins }));

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

// 托管 H5 静态资源（仅游戏本体，不暴露仓库根目录的安装包等文件）
const h5Root = path.join(__dirname, '..');
app.use('/css', express.static(path.join(h5Root, 'css')));
app.use('/js', express.static(path.join(h5Root, 'js')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(h5Root, 'manifest.json')));
app.get('/', (req, res) => res.sendFile(path.join(h5Root, 'index.html')));

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
