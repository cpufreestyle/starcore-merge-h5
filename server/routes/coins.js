/**
 * 星核币路由
 * - GET  /api/coins?deviceId=xxx               查询余额
 * - POST /api/coins/change                     变更余额（广告奖励 / 消耗上报）
 * - GET  /api/coins/transactions?deviceId=xxx  交易记录
 */
const express = require('express');
const router = express.Router();
const { UserModel, TxnModel } = require('../db');

// 与前端 shop.js reportCoinChange 的 reason 取值对齐
const REASONS = ['recharge', 'spend', 'ad_reward', 'pass_reward'];
// 单次变更上限，防止异常刷量
const MAX_ABS_DELTA = 100000;

function validDeviceId(v) {
  return typeof v === 'string' && v.length >= 4 && v.length <= 64;
}

router.get('/', (req, res) => {
  const { deviceId } = req.query;
  if (!validDeviceId(deviceId)) return res.status(400).json({ error: 'valid deviceId required' });
  res.json({ coins: UserModel.getCoins(deviceId) });
});

router.post('/change', (req, res) => {
  const { deviceId, delta, reason } = req.body || {};
  if (!validDeviceId(deviceId)) return res.status(400).json({ error: 'valid deviceId required' });
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_ABS_DELTA) {
    return res.status(400).json({ error: 'delta must be a non-zero integer within ±' + MAX_ABS_DELTA });
  }
  if (!REASONS.includes(reason)) {
    return res.status(400).json({ error: 'invalid reason, must be one of: ' + REASONS.join(', ') });
  }

  if (delta > 0) {
    return res.json({ coins: UserModel.addCoins(deviceId, delta, reason, null, reason), ok: true });
  }
  if (!UserModel.spendCoins(deviceId, -delta, reason)) {
    return res.status(409).json({ error: 'insufficient coins', coins: UserModel.getCoins(deviceId) });
  }
  res.json({ coins: UserModel.getCoins(deviceId), ok: true });
});

router.get('/transactions', (req, res) => {
  const { deviceId } = req.query;
  if (!validDeviceId(deviceId)) return res.status(400).json({ error: 'valid deviceId required' });
  res.json({ transactions: TxnModel.getRecent(deviceId, 50) });
});

module.exports = router;
