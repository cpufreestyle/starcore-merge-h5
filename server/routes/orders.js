/**
 * 订单路由
 * - POST /api/order/create     创建支付订单
 * - GET  /api/order/status     查询订单状态
 * - GET  /api/order/list       获取用户订单列表
 * - POST /api/order/simulate-pay  开发模式：模拟支付完成（接口）
 * - GET  /api/order/dev-pay?orderId=  开发模式：模拟支付完成（页面，供支付跳转）
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { OrderModel } = require('../db');
const config = require('../config');
const wechatService = require('../services/wechat');
const alipayService = require('../services/alipay');

// 充值套餐配置（与前端 js/shop.js 的 COIN_PACKS 保持同步，金额单位：分）
const COIN_PACKS = [
  { id: 'coin100', name: '100 星核币', price: 600, coins: 100 },      // ¥6
  { id: 'coin500', name: '500 星核币', price: 2500, coins: 550 },     // ¥25
  { id: 'coin1200', name: '1200 星核币', price: 5000, coins: 1500 },  // ¥50
  { id: 'coin3000', name: '3000 星核币', price: 12800, coins: 4000 }, // ¥128
];

/**
 * 获取客户端 IP（trust proxy 开启后 req.ip 已是真实 IP）
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req.ip || '127.0.0.1').replace(/^::ffff:/, '');
}

function validDeviceId(v) {
  return typeof v === 'string' && v.length >= 4 && v.length <= 64;
}

// 开发模式：模拟支付页面地址
function devPayUrl(orderId) {
  return '/api/order/dev-pay?orderId=' + encodeURIComponent(orderId);
}

// 开发模式：模拟支付宝所需的自动提交表单
function devPayForm(url) {
  return `<form id="alipaySubmit" action="${url}" method="GET">\n</form>`;
}

/**
 * POST /api/order/create
 * 创建支付订单
 *
 * Body: { deviceId, packId, method: 'wechat' | 'alipay' }
 * Response: { orderId, packId, amount, coins, method, wxPayUrl | alipayUrl, devMode }
 */
router.post('/create', async (req, res) => {
  try {
    const { deviceId, packId, method } = req.body || {};

    // 参数校验
    if (!validDeviceId(deviceId)) {
      return res.status(400).json({ error: 'valid deviceId required' });
    }
    if (!method || !['wechat', 'alipay'].includes(method)) {
      return res.status(400).json({ error: 'invalid method, must be wechat or alipay' });
    }
    const pack = COIN_PACKS.find(p => p.id === packId);
    if (!pack) {
      return res.status(400).json({ error: 'invalid packId' });
    }

    // 创建订单
    const orderId = 'SC' + Date.now() + uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase();
    OrderModel.create(orderId, deviceId, packId, pack.price, pack.coins, method);

    console.log('[Order] Created:', orderId, 'pack:', packId, 'method:', method);

    let payResult;
    if (config.isDev) {
      // 开发模式：跳转本地模拟支付页，页面会自动调用 simulate-pay
      const url = devPayUrl(orderId);
      payResult = {
        devMode: true,
        wxPayUrl: url,
        mwebUrl: url,
        alipayUrl: devPayForm(url),
        payUrl: url,
      };
    } else if (method === 'wechat') {
      // 微信支付 H5
      const result = await wechatService.createH5Order({
        orderId: orderId,
        amount: pack.price,
        description: pack.name,
        payerIp: getClientIp(req),
      });
      payResult = {
        wxPayUrl: result.mwebUrl,   // 前端 js/shop.js 读取 wxPayUrl
        mwebUrl: result.mwebUrl,
        prepayId: result.prepayId,
      };
    } else {
      // 支付宝 H5
      const result = await alipayService.createH5Order({
        orderId: orderId,
        amount: pack.price,
        subject: pack.name,
        body: pack.name,
        returnUrl: config.h5Origin,
      });
      payResult = {
        alipayUrl: result.payUrl,   // 前端 js/shop.js 读取 alipayUrl（自动提交表单 HTML）
        payUrl: result.payUrl,
      };
    }

    res.json({
      orderId: orderId,
      packId: packId,
      amount: pack.price,
      coins: pack.coins,
      method: method,
      ...payResult,
    });
  } catch (err) {
    console.error('[Order] Create error:', err);
    res.status(500).json({ error: 'order creation failed: ' + err.message });
  }
});

/**
 * GET /api/order/status?orderId=xxx
 * 查询订单状态（pending 时主动向第三方查询一次）
 */
router.get('/status', async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const order = OrderModel.get(orderId);
    if (!order) return res.status(404).json({ error: 'order not found' });

    // 如果订单还是 pending，尝试主动查询第三方
    if (order.status === 'pending' && !config.isDev) {
      try {
        if (order.method === 'wechat') {
          const result = await wechatService.queryOrder(orderId);
          if (result.tradeState === 'SUCCESS') {
            OrderModel.markPaid(orderId, result.transactionId);
          }
        } else if (order.method === 'alipay') {
          const result = await alipayService.queryOrder(orderId);
          if (result.tradeStatus === 'TRADE_SUCCESS' || result.tradeStatus === 'TRADE_FINISHED') {
            OrderModel.markPaid(orderId, result.tradeNo);
          }
        }
      } catch (e) {
        console.warn('[Order] Query third-party failed:', e.message);
      }
    }

    const updatedOrder = OrderModel.get(orderId);
    res.json({
      orderId: updatedOrder.order_id,
      status: updatedOrder.status,
      packId: updatedOrder.pack_id,   // 前端 js/shop.js 依据 packId 发放星核币
      amount: updatedOrder.amount,
      coins: updatedOrder.coins,
      method: updatedOrder.method,
      paidAt: updatedOrder.paid_at,
    });
  } catch (err) {
    console.error('[Order] Status error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/order/list?deviceId=xxx
 * 获取用户订单列表
 */
router.get('/list', (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!validDeviceId(deviceId)) return res.status(400).json({ error: 'valid deviceId required' });

    const orders = OrderModel.getRecentByDevice(deviceId, 20);
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/order/simulate-pay
 * 开发模式：模拟支付完成
 *
 * Body: { orderId }
 */
router.post('/simulate-pay', (req, res) => {
  if (!config.isDev) {
    return res.status(403).json({ error: 'only available in dev mode' });
  }
  try {
    const { orderId } = req.body || {};
    const order = OrderModel.get(orderId);
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (order.status !== 'pending') return res.json({ status: order.status, message: 'already processed' });

    const updated = OrderModel.markPaid(orderId, 'DEV_' + Date.now());
    res.json({
      orderId: updated.order_id,
      status: updated.status,
      coins: updated.coins,
      message: 'Payment simulated successfully',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/order/dev-pay?orderId=xxx
 * 开发模式：模拟收银台页面。create 返回的 wxPayUrl/alipayUrl 跳转到此处，
 * 页面自动调用 simulate-pay 后提示成功。
 */
router.get('/dev-pay', (req, res) => {
  if (!config.isDev) {
    return res.status(403).send('forbidden');
  }
  const orderId = req.query.orderId || '';
  const order = OrderModel.get(orderId);
  if (!order) return res.status(404).send('order not found');

  res.type('html').send(
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>模拟支付</title></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding-top:80px;">' +
    '<h2>🧪 开发模式模拟支付</h2>' +
    '<p>订单：' + orderId + '</p>' +
    '<p id="result">处理中…</p>' +
    '<script>' +
    'fetch("/api/order/simulate-pay",{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({orderId:' + JSON.stringify(orderId) + '})})' +
    '.then(function(r){return r.json()})' +
    '.then(function(d){document.getElementById("result").textContent=d.status==="paid"?"✅ 支付成功，可返回游戏":"⚠️ "+(d.message||d.error||"处理失败");})' +
    '.catch(function(){document.getElementById("result").textContent="❌ 请求失败";});' +
    '</script></body></html>'
  );
});

module.exports = router;
