/**
 * 支付宝 H5（手机网站支付）服务
 *
 * 接入流程：
 * 1. 在支付宝开放平台创建应用并签约「手机网站支付」产品
 * 2. 配置 .env 中的 ALIPAY_* 参数（应用私钥 / 支付宝公钥）
 * 3. 回调地址（ALIPAY_NOTIFY_URL）需外网可访问
 *
 * 文档：https://opendocs.alipay.com/open/02ivbs
 */
const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');

// 将单行 base64 密钥包装为 PEM 格式
function toPem(key, type) {
  if (!key) return '';
  if (key.includes('-----BEGIN')) return key;
  const lines = key.replace(/\s+/g, '').match(/.{1,64}/g) || [];
  const label = type === 'public' ? 'PUBLIC KEY' : 'RSA PRIVATE KEY';
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function appPrivateKey() {
  return toPem(config.alipay.appPrivateKey, 'private');
}

function alipayPublicKey() {
  return toPem(config.alipay.alipayPublicKey, 'public');
}

// 支付宝时间格式（GMT+8）：yyyy-MM-dd HH:mm:ss
function alipayTime() {
  return new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z/, '');
}

/**
 * RSA2 签名（SHA256withRSA）
 */
function sign(prestr) {
  const key = appPrivateKey();
  if (!key) throw new Error('Alipay app private key not configured');
  return crypto.createSign('RSA-SHA256').update(prestr, 'utf-8').sign(key, 'base64');
}

/**
 * 验证异步通知签名
 * 规则：去掉 sign、sign_type 与空值参数，按 key 升序拼接后 RSA2 验签
 */
function verifyNotifySign(params) {
  const pub = alipayPublicKey();
  const signature = params && params.sign;
  if (!pub || !signature) return false;

  const prestr = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] !== undefined)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');

  try {
    return crypto.createVerify('RSA-SHA256').update(prestr, 'utf-8').verify(pub, signature, 'base64');
  } catch (e) {
    console.error('[Alipay] Notify sign verify error:', e.message);
    return false;
  }
}

/**
 * 公共请求参数并整体 RSA2 签名
 */
function signedParams(method, bizContent, extra) {
  const params = Object.assign({
    app_id: config.alipay.appId,
    method: method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: alipayTime(),
    version: '1.0',
  }, extra);
  params.biz_content = JSON.stringify(bizContent);

  const prestr = Object.keys(params)
    .filter(k => k !== 'sign')
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  params.sign = sign(prestr);
  return params;
}

/**
 * 构造自动提交表单（前端 submit() 后跳转支付宝收银台）
 */
function buildPayForm(params) {
  const inputs = Object.keys(params)
    .map(k => `<input type="hidden" name="${k}" value="${String(params[k]).replace(/"/g, '&quot;')}" />`)
    .join('\n');
  return `<form id="alipaySubmit" action="${config.alipay.gateway}" method="POST">\n${inputs}\n</form>`;
}

/**
 * 创建手机网站（H5）支付订单
 *
 * @param {Object} params
 * @param {string} params.orderId - 商户订单号
 * @param {number} params.amount - 金额（分）
 * @param {string} params.subject - 商品标题
 * @param {string} params.body - 商品描述（可选）
 * @param {string} params.returnUrl - 支付完成后跳回地址（可选）
 * @returns {Promise<Object>} { payUrl } — payUrl 为自动提交表单 HTML
 */
async function createH5Order(params) {
  const { orderId, amount, subject, body, returnUrl } = params;

  if (!config.alipay.appId || !config.alipay.appPrivateKey) {
    throw new Error('Alipay credentials not configured (ALIPAY_APP_ID / ALIPAY_APP_PRIVATE_KEY)');
  }

  const bizContent = {
    out_trade_no: orderId,
    total_amount: (amount / 100).toFixed(2), // 分 → 元
    subject: subject || '合成星核 - 星核币充值',
    product_code: 'QUICK_WAP_WAY',
  };
  if (body) bizContent.body = body;

  const extra = {};
  if (config.alipay.notifyUrl) extra.notify_url = config.alipay.notifyUrl;
  if (returnUrl) extra.return_url = returnUrl;

  const payParams = signedParams('alipay.trade.wap.pay', bizContent, extra);
  console.log('[Alipay] WAP order created:', orderId);
  return { payUrl: buildPayForm(payParams) };
}

/**
 * 查询订单状态（alipay.trade.query）
 *
 * @returns {Promise<Object>} { tradeStatus, tradeNo }
 */
async function queryOrder(orderId) {
  const params = signedParams('alipay.trade.query', { out_trade_no: orderId });
  const query = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const res = await axios.post(config.alipay.gateway, query, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });

  const result = res.data && res.data.alipay_trade_query_response;
  if (!result || result.code !== '10000') {
    const msg = result ? `${result.code} ${result.msg || ''} ${result.sub_msg || ''}` : 'empty response';
    throw new Error('Alipay query failed: ' + msg);
  }
  return {
    tradeStatus: result.trade_status, // WAIT_BUYER_PAY | TRADE_SUCCESS | TRADE_FINISHED | TRADE_CLOSED
    tradeNo: result.trade_no,
  };
}

module.exports = {
  createH5Order,
  queryOrder,
  verifyNotifySign,
};
