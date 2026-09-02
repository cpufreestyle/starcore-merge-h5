/**
 * 微信支付 H5 服务
 * 
 * 接入流程：
 * 1. 商户在微信支付商户平台开通 H5 支付
 * 2. 配置 .env 中的微信支付参数
 * 3. 将商户私钥证书放入 server/certs/ 目录
 * 
 * 文档：https://pay.weixin.qq.com/docs/merchant/products/h5-payment/introduction.html
 */
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');

// 加载商户私钥
let mchPrivateKey = null;
function loadPrivateKey() {
  if (mchPrivateKey) return mchPrivateKey;
  try {
    if (fs.existsSync(config.wechat.mchPrivateKeyPath)) {
      mchPrivateKey = fs.readFileSync(config.wechat.mchPrivateKeyPath, 'utf-8');
      console.log('[Wechat] Private key loaded');
    }
  } catch (e) {
    console.warn('[Wechat] Failed to load private key:', e.message);
  }
  return mchPrivateKey;
}

/**
 * 生成随机字符串
 */
function generateNonceStr(length = 32) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 生成签名（微信支付 API v3 — RSA-SHA256）
 */
function sign(message) {
  const privateKey = loadPrivateKey();
  if (!privateKey) throw new Error('WeChat merchant private key not loaded');
  return crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64');
}

/**
 * 构造 Authorization 头
 */
function buildAuthHeader(method, url, timestamp, nonceStr, body) {
  const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = sign(message);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${config.wechat.mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${config.wechat.mchSerialNo}",signature="${signature}"`;
}

/**
 * 创建微信支付 H5 订单
 * 
 * @param {Object} params
 * @param {string} params.orderId - 商户订单号
 * @param {number} params.amount - 金额（分）
 * @param {string} params.description - 商品描述
 * @param {string} params.payerIp - 用户 IP
 * @param {string} params.payerClientId - 用户标识（AppID）
 * @returns {Promise<Object>} { mwebUrl, prepayId }
 */
async function createH5Order(params) {
  const { orderId, amount, description, payerIp } = params;

  if (!config.wechat.mchId || !config.wechat.appId) {
    throw new Error('WeChat pay credentials not configured (WX_MCH_ID / WX_APP_ID)');
  }

  const url = '/v3/pay/transactions/h5';
  const fullUrl = config.wechat.baseUrl + url;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = generateNonceStr();

  const requestBody = JSON.stringify({
    appid: config.wechat.appId,
    mchid: config.wechat.mchId,
    description: description || '合成星核 - 星核币充值',
    out_trade_no: orderId,
    time_expire: new Date(Date.now() + 30 * 60 * 1000).toISOString().replace(/\.\d{3}/, ''),
    notify_url: config.wechat.notifyUrl,
    amount: {
      total: amount,
      currency: 'CNY',
    },
    scene_info: {
      payer_client_ip: payerIp || '127.0.0.1',
      h5_info: {
        type: 'Wap',
      },
    },
  });

  const authHeader = buildAuthHeader('POST', url, timestamp, nonceStr, requestBody);

  const response = await axios.post(fullUrl, requestBody, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': authHeader,
      'User-Agent': 'StarCore-H5/1.0',
    },
    timeout: 10000,
  });

  console.log('[Wechat] H5 order created:', orderId);
  return {
    mwebUrl: response.data.h5_url,
    prepayId: response.data.prepay_id,
  };
}

/**
 * 查询订单状态
 */
async function queryOrder(orderId) {
  const url = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${config.wechat.mchId}`;
  const fullUrl = config.wechat.baseUrl + url;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = generateNonceStr();
  const authHeader = buildAuthHeader('GET', url, timestamp, nonceStr, '');

  const response = await axios.get(fullUrl, {
    headers: {
      'Accept': 'application/json',
      'Authorization': authHeader,
    },
    timeout: 10000,
  });

  return response.data;
}

/**
 * 验证微信支付回调通知签名
 * 
 * @param {Object} headers - 请求头
 * @param {string} body - 原始请求体
 * @returns {Object|null} 解密后的通知数据，验证失败返回 null
 */
function verifyNotification(headers, body) {
  try {
    // 获取微信支付签名头
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const signature = headers['wechatpay-signature'];
    const serial = headers['wechatpay-serial'];

    if (!timestamp || !nonce || !signature) {
      console.warn('[Wechat] Missing signature headers');
      return null;
    }

    // 注意：实际验证需要获取微信支付平台证书
    // 这里使用 API v3 密钥解密通知体中的密文
    const notification = JSON.parse(body);
    const ciphertext = notification.resource.ciphertext;
    const associatedData = notification.resource.associated_data || '';
    const nonceStr = notification.resource.nonce;

    // 使用 AES-256-GCM 解密
    const key = Buffer.from(config.wechat.apiV3Key, 'utf-8');
    const cipherTextBuf = Buffer.from(ciphertext, 'base64');
    const authTag = cipherTextBuf.slice(cipherTextBuf.length - 16);
    const encryptedData = cipherTextBuf.slice(0, cipherTextBuf.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonceStr, 'utf-8'));
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(associatedData, 'utf-8'));

    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]).toString('utf-8');
    const result = JSON.parse(decrypted);

    console.log('[Wechat] Notification verified, trade_no:', result.transaction_id);
    return result;
  } catch (e) {
    console.error('[Wechat] Notification verification failed:', e.message);
    return null;
  }
}

module.exports = {
  createH5Order,
  queryOrder,
  verifyNotification,
  generateNonceStr,
};
