/**
 * 合成星核 H5 — 数据库管理（SQLite）
 * 管理：订单、用户余额、交易记录
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

// 确保数据目录存在
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

// 初始化表结构
function initDB() {
  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      device_id TEXT PRIMARY KEY,
      coins INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    -- 订单表
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      amount INTEGER NOT NULL,        -- 金额（分）
      coins INTEGER NOT NULL,         -- 购买的星核币数量
      method TEXT NOT NULL,           -- 'wechat' | 'alipay'
      status TEXT DEFAULT 'pending',  -- 'pending' | 'paid' | 'failed' | 'refunded'
      trade_no TEXT,                  -- 第三方支付流水号
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      paid_at INTEGER,
      extra TEXT                      -- 额外信息 JSON
    );

    -- 交易记录表
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      type TEXT NOT NULL,             -- 'recharge' | 'spend' | 'ad_reward' | 'pass_reward'
      amount INTEGER NOT NULL,        -- 正数=增加，负数=减少
      balance_after INTEGER,
      order_id TEXT,
      description TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_orders_device ON orders(device_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_device ON transactions(device_id);
  `);
  console.log('[DB] Tables initialized');
}

initDB();

// ============================================================
//  用户操作
// ============================================================
const UserModel = {
  getOrCreate(deviceId) {
    db.prepare('INSERT OR IGNORE INTO users (device_id, coins) VALUES (?, 0)').run(deviceId);
    return db.prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId);
  },

  getCoins(deviceId) {
    const user = this.getOrCreate(deviceId);
    return user ? user.coins : 0;
  },

  addCoins(deviceId, amount, type, orderId, description) {
    const user = this.getOrCreate(deviceId);
    const newBalance = user.coins + amount;

    const txn = db.transaction(() => {
      db.prepare('UPDATE users SET coins = ?, updated_at = ? WHERE device_id = ?')
        .run(newBalance, Date.now(), deviceId);
      db.prepare(`INSERT INTO transactions (device_id, type, amount, balance_after, order_id, description)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(deviceId, type, amount, newBalance, orderId || null, description || '');
    });

    txn();
    return newBalance;
  },

  spendCoins(deviceId, amount, description) {
    const user = this.getOrCreate(deviceId);
    if (user.coins < amount) return false;

    const newBalance = user.coins - amount;
    const txn = db.transaction(() => {
      db.prepare('UPDATE users SET coins = ?, updated_at = ? WHERE device_id = ?')
        .run(newBalance, Date.now(), deviceId);
      db.prepare(`INSERT INTO transactions (device_id, type, amount, balance_after, description)
                  VALUES (?, 'spend', ?, ?, ?)`)
        .run(deviceId, -amount, newBalance, description || '');
    });

    txn();
    return true;
  },
};

// ============================================================
//  订单操作
// ============================================================
const OrderModel = {
  create(orderId, deviceId, packId, amount, coins, method) {
    db.prepare(`INSERT INTO orders (order_id, device_id, pack_id, amount, coins, method, status)
                VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
      .run(orderId, deviceId, packId, amount, coins, method);
    return this.get(orderId);
  },

  get(orderId) {
    return db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
  },

  markPaid(orderId, tradeNo) {
    const order = this.get(orderId);
    if (!order) return null;
    if (order.status !== 'pending') return order; // 幂等：仅 pending 可转入 paid，防重复发币

    const txn = db.transaction(() => {
      db.prepare('UPDATE orders SET status = ?, trade_no = ?, paid_at = ? WHERE order_id = ?')
        .run('paid', tradeNo || null, Date.now(), orderId);

      // 发放星核币
      if (order.coins > 0) {
        UserModel.addCoins(order.device_id, order.coins, 'recharge', orderId,
          '充值 ' + order.coins + ' 星核币');
      }
    });

    txn();
    console.log('[Order] Paid:', orderId, 'tradeNo:', tradeNo);
    return this.get(orderId);
  },

  markFailed(orderId) {
    db.prepare('UPDATE orders SET status = ? WHERE order_id = ? AND status = ?')
      .run('failed', orderId, 'pending');
  },

  getPendingByDevice(deviceId) {
    return db.prepare("SELECT * FROM orders WHERE device_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 5")
      .all(deviceId);
  },

  getRecentByDevice(deviceId, limit = 20) {
    return db.prepare('SELECT * FROM orders WHERE device_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(deviceId, limit);
  },
};

// ============================================================
//  交易记录
// ============================================================
const TxnModel = {
  getRecent(deviceId, limit = 50) {
    return db.prepare('SELECT * FROM transactions WHERE device_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(deviceId, limit);
  },
};

module.exports = { db, UserModel, OrderModel, TxnModel, initDB };
