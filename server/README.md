# 合成星核 H5 — 服务器

为 H5 游戏提供星核币余额同步、微信/支付宝 H5 充值与支付回调。无后端时游戏仍可独立运行（本地存档 + 模拟支付）。

## 快速开始

```bash
npm install                 # 安装依赖（express / better-sqlite3 等）
npm run dev                 # 开发模式（允许 /api/order/simulate-pay 模拟支付）
npm start                   # 生产模式（NODE_ENV=production）
```

服务器默认监听 `:3000`，同时托管游戏本体（`/`），前端通过 `js/shop.js` 中的 `CONFIG.API_BASE` 指向本服务。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/coins?deviceId=` | 查询星核币余额 |
| POST | `/api/coins/change` | 变更余额 `{deviceId, delta, reason}` |
| GET | `/api/coins/transactions?deviceId=` | 交易记录 |
| POST | `/api/order/create` | 创建支付订单 `{deviceId, packId, method}` |
| GET | `/api/order/status?orderId=` | 查询订单状态（会主动查询第三方） |
| GET | `/api/order/list?deviceId=` | 用户订单列表 |
| POST | `/api/order/simulate-pay` | **仅开发模式** 模拟支付完成 |
| POST | `/api/notify/wechat` | 微信支付 v3 回调（配置 WX_NOTIFY_URL） |
| POST | `/api/notify/alipay` | 支付宝异步通知（配置 ALIPAY_NOTIFY_URL） |

## 支付配置

1. 复制 `.env.example` 为 `.env`，填写微信/支付宝商户参数与回调地址。
2. 微信商户私钥放置于 `server/certs/wx_mch_private_key.pem`（或用 `WX_MCH_PRIVATE_KEY_PATH` 指定）。
3. 生产环境务必设置 `NODE_ENV=production`，此时模拟支付接口关闭、订单走真实支付并依赖回调/主动查询入账。

入账路径：支付回调（`/api/notify/*`）与前端轮询 `/api/order/status`（主动查询第三方）双保险，`markPaid` 幂等，不会重复发币。

## H5 激励视频广告

前端广告默认使用内置模拟广告。接入真实广告（优量汇）时，在 `index.html` 引入 `js/ads.js` 之前声明：

```html
<script>window.AD_CONFIG = { ylhAppId: '110xxxxxxx', ylhSlotId: 'xxxxxxxx' };</script>
```

未配置时 `window.StarAds.showRewardAd()` 返回 false，自动降级为模拟广告，行为不变。

## 数据

SQLite（WAL 模式）存于 `DB_PATH`（默认 `server/data/starcore.db`，已 gitignore），包含 `users`、`orders`、`transactions` 三张表，首次启动自动建表。

## 部署层优化

### 压缩（已在应用层启用）

`server/index.js` 已通过 `compression` 中间件按 `Accept-Encoding` 自动协商 **gzip / brotli**，对 HTML/JS/CSS/JSON 生效。若前端再挂 Nginx/CDN，其 brotli 会与之一致，无需关闭应用层压缩。

### 缓存策略（已在应用层启用）

- 静态资源（`/js/*`、`/css/*`、`/manifest.json`）：`Cache-Control: public, max-age=300, must-revalidate`，并带 `ETag`（内容哈希）重校验。
- `index.html` 与 `/sw.js`：`Cache-Control: no-cache`，始终重校验，保证发版即时生效。

> 注意：当前资源 URL 未做内容哈希（如 `game.ab12cd.js`），因此短缓存 + `must-revalidate` 是安全折中——发版后最多 5 分钟生效。若改为**内容哈希文件名**并让 `index.html` 引用之，即可升级为 `Cache-Control: public, max-age=31536000, immutable` 的强缓存，获得最佳性能（需引入一次构建/重命名步骤，与本项目"源码直引"惯例冲突，故未做）。

### HTTP/2（应用层需 TLS，建议在反向代理 / CDN 启用）

Node 应用本身以 HTTP/1.1 监听 `:3000`，**HTTP/2 应在前置 Nginx / CDN 终止 TLS 后启用**（浏览器不支持 h2c 明文）。示例（Nginx，前端为 `play.example.com`，回源到本服务）：

```nginx
server {
    listen 443 ssl http2;
    server_name play.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # brotli（需 nginx 编译 --with-http_brotli_module 或 nginx-plus）
    brotli on;
    brotli_comp_level 6;
    brotli_types text/css application/javascript application/json application/manifest+json image/svg+xml;

    gzip on;
    gzip_types text/css application/javascript application/json application/manifest+json;
    gzip_min_length 1024;

    # 全站回源
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Cloudflare / 阿里云 CDN 等开启"自动 HTTPS + HTTP/2 + Brotli"后同理，后端无需改动。
