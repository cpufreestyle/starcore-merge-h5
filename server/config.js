/**
 * 合成星核 H5 — 支付服务器配置
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  // 服务器
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  h5Origin: process.env.H5_ORIGIN || 'http://localhost:8080',

  // 是否为开发模式（模拟支付）
  // 仅在显式传入 --dev 且未声明生产环境时开启，防止生产环境误开 simulate-pay 接口
  isDev: process.argv.includes('--dev') && process.env.NODE_ENV !== 'production',

  // 数据库
  dbPath: process.env.DB_PATH || path.join(__dirname, 'data', 'starcore.db'),

  // 微信支付 H5
  wechat: {
    mchId: process.env.WX_MCH_ID || '',
    apiV3Key: process.env.WX_API_V3_KEY || '',
    mchSerialNo: process.env.WX_MCH_SERIAL_NO || '',
    mchPrivateKeyPath: process.env.WX_MCH_PRIVATE_KEY_PATH || path.join(__dirname, 'certs', 'wx_mch_private_key.pem'),
    appId: process.env.WX_APP_ID || '',
    notifyUrl: process.env.WX_NOTIFY_URL || '',
    // 微信支付 API 基础地址
    baseUrl: 'https://api.mch.weixin.qq.com',
  },

  // 支付宝 H5
  alipay: {
    appId: process.env.ALIPAY_APP_ID || '',
    appPrivateKey: process.env.ALIPAY_APP_PRIVATE_KEY || '',
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || '',
    gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
  },

  // 安全
  jwtSecret: process.env.JWT_SECRET || 'starcore_dev_secret_2024',
  paySignKey: process.env.PAY_SIGN_KEY || 'starcore_pay_sign_2024',
};

module.exports = config;
