/**
 * 支付回调路由
 * - POST /api/notify/wechat   微信支付 v3 回调
 * - POST /api/notify/alipay   支付宝异步通知
 *
 * 两个入口均为幂等：重复通知不会重复发币（OrderModel.markPaid 仅在 pending 状态生效）
 */
const express = require('express');
const router = express.Router();
const { OrderModel } = require('../db');
const wechatService = require('../services/wechat');
const alipayService = require('../services/alipay');

// 微信 v3 回调：验签/解密需要原始 body
router.use('/wechat', express.json({
  limit: '100kb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

router.post('/wechat', (req, res) => {
  try {
    const raw = req.rawBody ? req.rawBody.toString('utf-8') : '';
    const result = wechatService.verifyNotification(req.headers, raw);
    if (!result) {
      // 验签失败返回 5xx，微信会按策略重试
      return res.status(500).json({ code: 'FAIL', message: '验证失败' });
    }

    if (result.trade_state === 'SUCCESS' && result.out_trade_no) {
      const order = OrderModel.get(result.out_trade_no);
      if (!order) {
        console.warn('[Notify] Wechat: unknown order', result.out_trade_no);
      } else {
        OrderModel.markPaid(result.out_trade_no, result.transaction_id);
      }
    }
    // 已受理（无论订单状态如何）均返回成功，停止重试
    res.json({ code: 'SUCCESS', message: '成功' });
  } catch (err) {
    console.error('[Notify] Wechat error:', err);
    res.status(500).json({ code: 'FAIL', message: '处理失败' });
  }
});

// 支付宝异步通知：application/x-www-form-urlencoded
router.post('/alipay', express.urlencoded({ extended: false }), (req, res) => {
  try {
    const params = req.body || {};
    if (!alipayService.verifyNotifySign(params)) {
      console.warn('[Notify] Alipay: sign verify failed');
      return res.send('failure');
    }

    if ((params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED') && params.out_trade_no) {
      const order = OrderModel.get(params.out_trade_no);
      if (!order) {
        console.warn('[Notify] Alipay: unknown order', params.out_trade_no);
      } else {
        OrderModel.markPaid(params.out_trade_no, params.trade_no);
      }
    }
    res.send('success');
  } catch (err) {
    console.error('[Notify] Alipay error:', err);
    res.send('failure');
  }
});

module.exports = router;
