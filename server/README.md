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
