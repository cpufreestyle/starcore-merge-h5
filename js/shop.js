// 合成星核 — 付费系统 v3（原生桥接 + H5 fallback）
// 广告：Android 壳 → 穿山甲原生 SDK | H5 → 模拟广告
// 充值：Android 壳 → 微信/支付宝原生 SDK | H5 → 模拟支付
// 服务端：可选，用于订单管理和余额同步
(function () {
  'use strict';

  // === 检测运行环境 ===
  const isNative = (typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge.isNative && window.AndroidBridge.isNative());
  console.log('[Shop] Running in ' + (isNative ? 'Native Android' : 'H5 Browser') + ' mode');

  // === 配置 ===
  const CONFIG = {
    API_BASE: '',        // 服务端 API（可选）
    CSJ_AD_SLOT: '',     // 穿山甲广告位 ID（原生模式由 Android 端配置）
    YLH_AD_SLOT: '',     // 优量汇广告位 ID（H5 备用）
    WX_MCH_ID: '',       // 微信商户号
    ALIPAY_APP_ID: '',   // 支付宝应用 ID
  };

  // === 广告系统 ===
  let adWatching = false;
  let adCallback = null;
  let adRewardConfig = null;

  const AD_REWARDS = [
    { type: 'coins', amount: 20, icon: '💎', desc: '20 星核币' },
    { type: 'tools', amount: 1, icon: '⚡', desc: '随机道具 x2' },
    { type: 'coins', amount: 50, icon: '💎', desc: '50 星核币（通行证双倍）' },
  ];

  function showAd(rewardIndex, callback) {
    if (adWatching) return;
    adWatching = true;
    adCallback = callback;
    adRewardConfig = AD_REWARDS[rewardIndex] || AD_REWARDS[0];

    if (isNative) {
      showNativeRewardAd();
    } else if (window.StarAds && window.StarAds.showRewardAd(
      grantAdReward,
      function (completed) {
        adWatching = false;
        if (adCallback) { adCallback(completed); adCallback = null; }
        if (!completed) toast('广告未完成，未获得奖励');
      }
    )) {
      // 真实激励视频已发起（js/ads.js），结果由 StarAds 回调接管
    } else {
      showFallbackAd();
    }
  }

  // === 原生激励视频（通过 AndroidBridge） ===
  function showNativeRewardAd() {
    const overlay = document.getElementById('adOverlay');
    const tip = document.getElementById('adTip');
    const progressFill = document.getElementById('adProgressFill');
    const claimBtn = document.getElementById('adClaimBtn');
    const skipBtn = document.getElementById('adSkipBtn');

    // 显示广告遮罩
    const desc = document.getElementById('adDesc');
    const rewardEl = document.getElementById('adReward');
    desc.textContent = '观看完整广告获取免费奖励';
    rewardEl.textContent = '🎁 奖励：' + adRewardConfig.icon + ' ' + adRewardConfig.desc;
    progressFill.style.width = '0%';
    tip.textContent = '📢 广告加载中…';
    claimBtn.classList.add('hidden');
    skipBtn.textContent = '取消';
    skipBtn.onclick = function () {
      adWatching = false;
      overlay.classList.add('hidden');
      if (adCallback) { adCallback(false); adCallback = null; }
    };
    overlay.classList.remove('hidden');

    // 重置原生广告结果
    window.AndroidBridge.resetAdResult();
    // 调用原生广告
    window.AndroidBridge.showRewardAd();

    // 轮询广告结果
    let pollCount = 0;
    const maxPoll = 600; // 最多等60秒（每100ms轮询一次）
    const pollInterval = setInterval(() => {
      pollCount++;
      const result = window.AndroidBridge.getAdResult();

      // 更新进度条（模拟进度感）
      if (pollCount < 10) {
        progressFill.style.width = (pollCount * 5) + '%';
        tip.textContent = '📢 广告加载中…';
      } else if (pollCount < 30) {
        progressFill.style.width = '50%';
        tip.textContent = '🎬 广告播放中…';
      } else {
        progressFill.style.width = '90%';
        tip.textContent = '🎬 广告播放中…';
      }

      if (result === 'completed') {
        clearInterval(pollInterval);
        progressFill.style.width = '100%';
        tip.textContent = '✅ 广告播放完毕！';
        claimBtn.classList.remove('hidden');
        skipBtn.textContent = '放弃奖励';
        claimBtn.onclick = function () {
          overlay.classList.add('hidden');
          adWatching = false;
          grantAdReward();
          if (adCallback) { adCallback(true); adCallback = null; }
        };
      } else if (result === 'skipped') {
        clearInterval(pollInterval);
        overlay.classList.add('hidden');
        adWatching = false;
        if (adCallback) { adCallback(false); adCallback = null; }
        toast('已跳过广告，未获得奖励');
      } else if (result === 'failed') {
        clearInterval(pollInterval);
        tip.textContent = '⚠️ 广告加载失败，使用备用方式…';
        // 降级到 fallback
        setTimeout(() => {
          overlay.classList.add('hidden');
          showFallbackAd();
        }, 800);
      } else if (pollCount >= maxPoll) {
        clearInterval(pollInterval);
        overlay.classList.add('hidden');
        adWatching = false;
        toast('⏰ 广告超时，请稍后重试');
        if (adCallback) { adCallback(false); adCallback = null; }
      }
    }, 100);
  }

  // === Fallback 广告（H5 模式 / 原生失败降级） ===
  function showFallbackAd() {
    const overlay = document.getElementById('adOverlay');
    const desc = document.getElementById('adDesc');
    const rewardEl = document.getElementById('adReward');
    const progressFill = document.getElementById('adProgressFill');
    const tip = document.getElementById('adTip');
    const claimBtn = document.getElementById('adClaimBtn');
    const skipBtn = document.getElementById('adSkipBtn');

    desc.textContent = '观看完整广告获取免费奖励';
    rewardEl.textContent = '🎁 奖励：' + adRewardConfig.icon + ' ' + adRewardConfig.desc;
    progressFill.style.width = '0%';
    tip.textContent = '广告加载中…';
    claimBtn.classList.add('hidden');
    skipBtn.textContent = '跳过（无奖励）';
    skipBtn.onclick = function () {
      clearInterval(interval);
      onAdSkip();
    };
    overlay.classList.remove('hidden');

    let progress = 0;
    const adDuration = 5000;
    const interval = setInterval(() => {
      progress += 2;
      progressFill.style.width = progress + '%';
      if (progress < 100) {
        tip.textContent = '广告播放中… ' + Math.ceil((100 - progress) / 2) + '秒';
      } else {
        clearInterval(interval);
        tip.textContent = '✅ 广告播放完毕！';
        claimBtn.classList.remove('hidden');
        skipBtn.textContent = '放弃奖励';
        claimBtn.onclick = function () {
          overlay.classList.add('hidden');
          adWatching = false;
          grantAdReward();
          if (adCallback) { adCallback(true); adCallback = null; }
        };
      }
    }, adDuration / 50);
  }

  // 发放广告奖励
  function grantAdReward() {
    if (adRewardConfig.type === 'coins') {
      const mult = passData.active ? 2 : 1;
      addCoins(adRewardConfig.amount * mult);
      toast('🎁 获得 ' + (adRewardConfig.amount * mult) + ' 💎' + (mult > 1 ? '（通行证双倍！）' : ''));
    } else if (adRewardConfig.type === 'tools') {
      const tools = window.StarCoreTools;
      if (tools) {
        const toolKeys = ['lightning', 'shuffle', 'hint', 'bomb'];
        const t1 = toolKeys[Math.floor(Math.random() * 4)];
        const t2 = toolKeys[Math.floor(Math.random() * 4)];
        tools[t1] = (tools[t1] || 0) + 1;
        tools[t2] = (tools[t2] || 0) + 1;
        if (window.StarCoreUpdateToolHud) window.StarCoreUpdateToolHud();
        toast('🎁 获得 ⚡🔄💡💥 各随机道具！');
      }
    }
  }

  function onAdSkip() {
    const overlay = document.getElementById('adOverlay');
    overlay.classList.add('hidden');
    adWatching = false;
    if (adCallback) { adCallback(false); adCallback = null; }
    toast('已跳过广告，未获得奖励');
  }

  // === 星核币 ===
  let coins = 0;
  function loadCoins() {
    try { coins = parseInt(localStorage.getItem('starcore_coins') || '0', 10) || 0; } catch (e) { coins = 0; }
    syncCoinsFromServer();
    updateCoinDisplay();
  }
  function saveCoins() {
    try { localStorage.setItem('starcore_coins', String(coins)); } catch (e) {}
    updateCoinDisplay();
  }
  function addCoins(n) {
    coins = Math.max(0, coins + n);
    saveCoins();
    reportCoinChange(n, 'ad_reward');
  }
  function spendCoins(n) {
    if (coins < n) return false;
    coins -= n;
    saveCoins();
    reportCoinChange(-n, 'spend');
    return true;
  }
  function updateCoinDisplay() {
    const els = document.querySelectorAll('#coinDisplay, #shopCoinDisplay');
    els.forEach(el => { if (el) el.textContent = '💎 ' + coins; });
  }

  function syncCoinsFromServer() {
    if (!CONFIG.API_BASE) return;
    const deviceId = getDeviceId();
    fetch(CONFIG.API_BASE + '/api/coins?deviceId=' + encodeURIComponent(deviceId))
      .then(r => r.json())
      .then(data => {
        if (data && typeof data.coins === 'number' && data.coins > coins) {
          coins = data.coins;
          saveCoins();
        }
      })
      .catch(() => {});
  }

  function reportCoinChange(delta, reason) {
    if (!CONFIG.API_BASE) return;
    const deviceId = getDeviceId();
    fetch(CONFIG.API_BASE + '/api/coins/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, delta, reason, timestamp: Date.now() }),
    }).catch(() => {});
  }

  function getDeviceId() {
    // 原生模式从 AndroidBridge 获取
    if (isNative) {
      return window.AndroidBridge.getDeviceId();
    }
    let id = localStorage.getItem('starcore_device_id');
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('starcore_device_id', id);
    }
    return id;
  }

  // === 充值系统 ===
  const COIN_PACKS = [
    { id: 'coin100', icon: '💎', name: '100 星核币', desc: '小额体验', price: 6, priceText: '¥6', coins: 100 },
    { id: 'coin500', icon: '💎', name: '500 星核币', desc: '送50', price: 25, priceText: '¥25', coins: 550, badge: '+10%' },
    { id: 'coin1200', icon: '💎', name: '1200 星核币', desc: '送300', price: 50, priceText: '¥50', coins: 1500, badge: '+25%' },
    { id: 'coin3000', icon: '💎', name: '3000 星核币', desc: '送1000', price: 128, priceText: '¥128', coins: 4000, badge: '+33%' },
  ];

  function buyCoins(packId) {
    const pack = COIN_PACKS.find(p => p.id === packId);
    if (!pack) return;

    if (isNative) {
      // 原生模式：弹出支付方式选择，通过 AndroidBridge 调用原生支付
      showPaymentSelector(pack);
    } else if (!CONFIG.API_BASE) {
      // H5 模式无服务端：模拟支付
      toast('⚠️ 支付服务未配置，使用模拟支付');
      simulatePayment(pack);
    } else {
      // H5 模式有服务端：走 H5 支付流程
      showPaymentSelector(pack);
    }
  }

  function showPaymentSelector(pack) {
    const existing = document.getElementById('paySelectorOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'paySelectorOverlay';
    overlay.className = 'overlay';
    overlay.innerHTML =
      '<div class="panel" style="max-width:340px;">' +
      '<h2>💳 选择支付方式</h2>' +
      '<p class="desc">' + pack.name + ' — ' + pack.priceText + '</p>' +
      '<button class="btn primary" id="payWxBtn" style="background:linear-gradient(90deg,#07c160,#06ad56);border:none;">' +
        '<span style="font-size:20px;vertical-align:middle;">💚</span> 微信支付 ' + pack.priceText + '</button>' +
      '<button class="btn" id="payAlipayBtn" style="background:linear-gradient(90deg,#1677ff,#0958d9);border:none;">' +
        '<span style="font-size:20px;vertical-align:middle;">💙</span> 支付宝 ' + pack.priceText + '</button>' +
      '<button class="btn ghost" id="payCancelBtn">取消</button>' +
    '</div>';
    document.body.appendChild(overlay);

    document.getElementById('payWxBtn').addEventListener('click', () => {
      overlay.remove();
      initiatePayment(pack, 'wechat');
    });
    document.getElementById('payAlipayBtn').addEventListener('click', () => {
      overlay.remove();
      initiatePayment(pack, 'alipay');
    });
    document.getElementById('payCancelBtn').addEventListener('click', () => overlay.remove());
  }

  function initiatePayment(pack, method) {
    if (isNative) {
      // === 原生支付 ===
      initiateNativePayment(pack, method);
    } else if (CONFIG.API_BASE) {
      // === H5 服务端支付 ===
      initiateH5Payment(pack, method);
    } else {
      // === 模拟支付 ===
      simulatePayment(pack);
    }
  }

  // 原生支付（通过 AndroidBridge）
  function initiateNativePayment(pack, method) {
    toast('💳 正在创建' + (method === 'wechat' ? '微信' : '支付宝') + '订单…');

    // 如果有服务端，先创建订单获取支付参数
    if (CONFIG.API_BASE) {
      fetch(CONFIG.API_BASE + '/api/order/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          packId: pack.id,
          amount: pack.price,
          coins: pack.coins,
          method: method,
          timestamp: Date.now(),
        }),
      })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          toast('❌ 订单创建失败：' + data.error);
          return;
        }
        if (method === 'wechat' && data.wxPayParams) {
          // 通过 AndroidBridge 调起微信支付
          window.AndroidBridge.resetPayResult();
          window.AndroidBridge.payWechat(JSON.stringify(data.wxPayParams));
          pollNativePayResult(data.orderId, pack);
        } else if (method === 'alipay' && data.alipayOrderInfo) {
          // 通过 AndroidBridge 调起支付宝
          window.AndroidBridge.resetPayResult();
          window.AndroidBridge.payAlipay(data.alipayOrderInfo);
          pollNativePayResult(data.orderId, pack);
        } else {
          toast('❌ 支付参数异常');
        }
      })
      .catch(err => {
        console.error('[Pay] Order create failed:', err);
        toast('❌ 网络错误，使用模拟支付');
        simulatePayment(pack);
      });
    } else {
      // 无服务端，直接模拟
      simulatePayment(pack);
    }
  }

  // 轮询原生支付结果
  function pollNativePayResult(orderId, pack) {
    let pollCount = 0;
    const maxPoll = 600; // 60秒超时
    toast('⏳ 等待支付确认…');

    const interval = setInterval(() => {
      pollCount++;
      const result = window.AndroidBridge.getPayResult();

      if (result === 'success') {
        clearInterval(interval);
        addCoins(pack.coins);
        toast('✅ 充值成功！获得 ' + pack.coins + ' 💎');
        renderShop();
      } else if (result === 'cancel') {
        clearInterval(interval);
        toast('已取消支付');
      } else if (result === 'failed') {
        clearInterval(interval);
        toast('❌ 支付失败，请重试');
      } else if (pollCount >= maxPoll) {
        clearInterval(interval);
        toast('⏰ 支付超时，如已支付请重启游戏');
      }
    }, 100);
  }

  // H5 支付（有服务端时）
  function initiateH5Payment(pack, method) {
    const deviceId = getDeviceId();
    toast('💳 正在创建' + (method === 'wechat' ? '微信' : '支付宝') + '订单…');

    fetch(CONFIG.API_BASE + '/api/order/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId, packId: pack.id, amount: pack.price,
        coins: pack.coins, method, timestamp: Date.now(),
      }),
    })
    .then(r => r.json())
    .then(data => {
      if (data.error) { toast('❌ 订单创建失败：' + data.error); return; }

      if (method === 'wechat') {
        if (data.wxPayUrl) {
          window.location.href = data.wxPayUrl;
          pollOrderStatus(data.orderId);
        } else if (data.wxJsApiParams) {
          callWeixinJsApi(data.wxJsApiParams, data.orderId, pack);
        } else {
          toast('❌ 微信支付参数异常');
        }
      } else if (method === 'alipay') {
        if (data.alipayUrl) {
          const form = document.createElement('div');
          form.innerHTML = data.alipayUrl;
          document.body.appendChild(form);
          const alipayForm = form.querySelector('form');
          if (alipayForm) alipayForm.submit();
          pollOrderStatus(data.orderId);
        } else {
          toast('❌ 支付宝参数异常');
        }
      }
    })
    .catch(err => {
      console.error('[Pay] Order create failed:', err);
      toast('❌ 网络错误，请稍后重试');
    });
  }

  // 微信 JSAPI 支付（微信浏览器内）
  function callWeixinJsApi(params, orderId, pack) {
    if (typeof WeixinJSBridge === 'undefined') {
      toast('⚠️ 请在微信中打开本页面完成支付');
      return;
    }
    WeixinJSBridge.invoke('getBrandWCPayRequest', {
      appId: params.appId,
      timeStamp: params.timeStamp,
      nonceStr: params.nonceStr,
      package: params.package,
      signType: params.signType,
      paySign: params.paySign,
    }, function (res) {
      if (res.err_msg === 'get_brand_wcpay_request:ok') {
        toast('✅ 支付成功！正在发放星核币…');
        pollOrderStatus(orderId);
      } else if (res.err_msg === 'get_brand_wcpay_request:cancel') {
        toast('已取消支付');
      } else {
        toast('❌ 支付失败：' + res.err_msg);
      }
    });
  }

  // 轮询订单状态（H5 模式）
  let pollTimer = null;
  function pollOrderStatus(orderId) {
    if (pollTimer) clearInterval(pollTimer);
    let attempts = 0;
    toast('⏳ 等待支付确认…');
    pollTimer = setInterval(() => {
      attempts++;
      if (attempts > 60) {
        clearInterval(pollTimer);
        toast('⏰ 支付确认超时，如已支付请重启游戏');
        return;
      }
      fetch(CONFIG.API_BASE + '/api/order/status?orderId=' + orderId)
        .then(r => r.json())
        .then(data => {
          if (data.status === 'paid') {
            clearInterval(pollTimer);
            const pack = COIN_PACKS.find(p => p.id === data.packId);
            if (pack) {
              addCoins(pack.coins);
              toast('✅ 充值成功！获得 ' + pack.coins + ' 💎');
              renderShop();
            }
          }
        })
        .catch(() => {});
    }, 5000);
  }

  // 模拟支付
  function simulatePayment(pack) {
    toast('💳 [模拟] 支付 ' + pack.priceText + ' 购买 ' + pack.coins + ' 💎');
    setTimeout(() => {
      addCoins(pack.coins);
      toast('✅ [模拟] 充值成功！获得 ' + pack.coins + ' 💎');
      renderShop();
    }, 1500);
  }

  // === 通行证 ===
  let passData = { active: false, expire: 0, lastClaim: '' };
  function loadPass() {
    try { passData = JSON.parse(localStorage.getItem('starcore_pass') || 'null') || passData; } catch (e) {}
    if (passData.active && Date.now() > passData.expire) {
      passData.active = false;
      savePass();
    }
  }
  function savePass() {
    try { localStorage.setItem('starcore_pass', JSON.stringify(passData)); } catch (e) {}
  }
  function buyPass() {
    if (spendCoins(300)) {
      passData.active = true;
      passData.expire = Date.now() + 30 * 24 * 60 * 60 * 1000;
      savePass();
      toast('🎫 星核通行证已激活！30天内每日领取奖励');
      renderShop();
    } else {
      toast('💎 星核币不足！需要 300 💎');
    }
  }
  function claimPassDaily() {
    if (!passData.active) return;
    const today = new Date().toISOString().slice(0, 10);
    if (passData.lastClaim === today) {
      toast('今日已领取，明天再来吧！');
      return;
    }
    passData.lastClaim = today;
    savePass();
    addCoins(30);
    const tools = window.StarCoreTools;
    if (tools) {
      tools.lightning = (tools.lightning || 0) + 1;
      tools.shuffle = (tools.shuffle || 0) + 1;
      tools.hint = (tools.hint || 0) + 2;
      tools.bomb = (tools.bomb || 0) + 1;
      if (window.StarCoreUpdateToolHud) window.StarCoreUpdateToolHud();
    }
    toast('🎫 通行证每日奖励：+30💎 + 道具补给！');
  }

  // === 皮肤系统 ===
  const SKINS = [
    { id: 'default', name: '深空', icon: '🌌', desc: '默认主题', price: 0, cls: '' },
    { id: 'ocean', name: '深海', icon: '🌊', desc: '蓝色海洋风', price: 100, cls: 'skin-ocean' },
    { id: 'forest', name: '森林', icon: '🌿', desc: '绿色自然风', price: 100, cls: 'skin-forest' },
    { id: 'sunset', name: '夕阳', icon: '🌅', desc: '暖色黄昏风', price: 150, cls: 'skin-sunset' },
    { id: 'neon', name: '霓虹', icon: '💜', desc: '赛博朋克风', price: 200, cls: 'skin-neon' },
  ];
  let ownedSkins = new Set(['default']);
  let equippedSkin = 'default';

  function loadSkins() {
    try {
      ownedSkins = new Set(JSON.parse(localStorage.getItem('starcore_skins_owned') || '["default"]'));
      equippedSkin = localStorage.getItem('starcore_skin_equipped') || 'default';
    } catch (e) {}
    applySkin();
  }
  function saveSkins() {
    try {
      localStorage.setItem('starcore_skins_owned', JSON.stringify([...ownedSkins]));
      localStorage.setItem('starcore_skin_equipped', equippedSkin);
    } catch (e) {}
  }
  function applySkin() {
    document.body.className = '';
    const skin = SKINS.find(s => s.id === equippedSkin);
    if (skin && skin.cls) document.body.classList.add(skin.cls);
  }
  function buySkin(id) {
    const skin = SKINS.find(s => s.id === id);
    if (!skin) return;
    if (ownedSkins.has(id)) {
      equippedSkin = id;
      applySkin();
      saveSkins();
      toast('🌟 已切换皮肤：' + skin.name);
      renderShop();
      return;
    }
    if (spendCoins(skin.price)) {
      ownedSkins.add(id);
      equippedSkin = id;
      applySkin();
      saveSkins();
      toast('🌟 购买并装备：' + skin.name);
      renderShop();
    } else {
      toast('💎 星核币不足！需要 ' + skin.price + ' 💎');
    }
  }

  // === 道具购买 ===
  const TOOL_PACKS = [
    { id: 'lightning1', icon: '⚡', name: '闪电 x1', desc: '炸掉一个核心', price: 30, tool: 'lightning', qty: 1 },
    { id: 'lightning5', icon: '⚡', name: '闪电 x5', desc: '批量优惠装', price: 120, tool: 'lightning', qty: 5, badge: '省30' },
    { id: 'shuffle1', icon: '🔄', name: '洗牌 x1', desc: '重新排列棋盘', price: 40, tool: 'shuffle', qty: 1 },
    { id: 'shuffle3', icon: '🔄', name: '洗牌 x3', desc: '批量优惠装', price: 100, tool: 'shuffle', qty: 3, badge: '省20' },
    { id: 'hint3', icon: '💡', name: '提示 x3', desc: '高亮可合并对', price: 30, tool: 'hint', qty: 3 },
    { id: 'hint10', icon: '💡', name: '提示 x10', desc: '批量优惠装', price: 80, tool: 'hint', qty: 10, badge: '省20' },
    { id: 'bomb1', icon: '💥', name: '炸弹 x1', desc: '清除3x3范围', price: 50, tool: 'bomb', qty: 1 },
    { id: 'bomb3', icon: '💥', name: '炸弹 x3', desc: '批量优惠装', price: 120, tool: 'bomb', qty: 3, badge: '省30' },
  ];
  function buyTool(packId) {
    const pack = TOOL_PACKS.find(p => p.id === packId);
    if (!pack) return;
    if (spendCoins(pack.price)) {
      const tools = window.StarCoreTools;
      if (tools) {
        tools[pack.tool] = (tools[pack.tool] || 0) + pack.qty;
        if (window.StarCoreUpdateToolHud) window.StarCoreUpdateToolHud();
      }
      toast('✅ 购买成功：' + pack.name);
    } else {
      toast('💎 星核币不足！需要 ' + pack.price + ' 💎');
    }
  }

  // === 续命 ===
  let reviveUsed = false;
  function canRevive() {
    return !reviveUsed && coins >= 50;
  }
  function doRevive() {
    if (!canRevive()) return false;
    if (!spendCoins(50)) return false;
    reviveUsed = false;
    return true;
  }
  function resetRevive() { reviveUsed = false; }

  // === 商店渲染 ===
  function renderShop() {
    updateCoinDisplay();

    const itemsEl = document.getElementById('shopItems');
    if (itemsEl) {
      itemsEl.innerHTML = TOOL_PACKS.map(p =>
        '<div class="shop-item" data-pack="' + p.id + '">' +
        (p.badge ? '<span class="shop-item-badge">' + p.badge + '</span>' : '') +
        '<div class="shop-item-icon">' + p.icon + '</div>' +
        '<div class="shop-item-name">' + p.name + '</div>' +
        '<div class="shop-item-desc">' + p.desc + '</div>' +
        '<div class="shop-item-price">💎 ' + p.price + '</div>' +
        '</div>'
      ).join('');
      itemsEl.querySelectorAll('.shop-item').forEach(el => {
        el.addEventListener('click', () => buyTool(el.dataset.pack));
      });
    }

    const skinsEl = document.getElementById('shopSkins');
    if (skinsEl) {
      skinsEl.innerHTML = SKINS.map(s => {
        const owned = ownedSkins.has(s.id);
        const equipped = equippedSkin === s.id;
        return '<div class="shop-item ' + (owned ? 'owned' : '') + ' ' + (equipped ? 'equipped' : '') + '" data-skin="' + s.id + '">' +
          (equipped ? '<span class="shop-item-badge">已装备</span>' : '') +
          '<div class="shop-item-icon">' + s.icon + '</div>' +
          '<div class="shop-item-name">' + s.name + '</div>' +
          '<div class="shop-item-desc">' + s.desc + '</div>' +
          (equipped ? '<div class="shop-item-price owned">已装备</div>' :
           owned ? '<div class="shop-item-price owned">点击装备</div>' :
           '<div class="shop-item-price">💎 ' + s.price + '</div>') +
          '</div>';
      }).join('');
      skinsEl.querySelectorAll('.shop-item').forEach(el => {
        el.addEventListener('click', () => buySkin(el.dataset.skin));
      });
    }

    const coinsEl = document.getElementById('shopCoins');
    if (coinsEl) {
      coinsEl.innerHTML = COIN_PACKS.map(p =>
        '<div class="shop-item" data-coin="' + p.id + '">' +
        (p.badge ? '<span class="shop-item-badge">' + p.badge + '</span>' : '') +
        '<div class="shop-item-icon">' + p.icon + '</div>' +
        '<div class="shop-item-name">' + p.name + '</div>' +
        '<div class="shop-item-desc">' + p.desc + '</div>' +
        '<div class="shop-item-price free">' + p.priceText + '</div>' +
        '</div>'
      ).join('');
      coinsEl.querySelectorAll('.shop-item').forEach(el => {
        el.addEventListener('click', () => buyCoins(el.dataset.coin));
      });
    }

    const passEl = document.getElementById('shopPass');
    if (passEl) {
      if (passData.active) {
        const daysLeft = Math.ceil((passData.expire - Date.now()) / (24 * 60 * 60 * 1000));
        const today = new Date().toISOString().slice(0, 10);
        const claimed = passData.lastClaim === today;
        passEl.className = 'shop-pass active';
        passEl.innerHTML =
          '<div class="shop-pass-title">🎫 星核通行证（有效）</div>' +
          '<div class="shop-pass-desc">剩余 ' + daysLeft + ' 天 · 每日可领 30💎 + 道具补给 · 广告奖励双倍</div>' +
          '<button class="btn primary" id="passClaimBtn" ' + (claimed ? 'disabled' : '') + '>' + (claimed ? '今日已领取' : '领取今日奖励') + '</button>';
        const claimBtn = document.getElementById('passClaimBtn');
        if (claimBtn) claimBtn.addEventListener('click', claimPassDaily);
      } else {
        passEl.className = 'shop-pass';
        passEl.innerHTML =
          '<div class="shop-pass-title">🎫 星核通行证</div>' +
          '<div class="shop-pass-desc">30天权益 · 每日30💎+道具 · 广告奖励双倍 · 专属身份</div>' +
          '<button class="btn primary" id="passBuyBtn">💎 300 购买</button>';
        const buyBtn = document.getElementById('passBuyBtn');
        if (buyBtn) buyBtn.addEventListener('click', buyPass);
      }
    }
  }

  // === 工具函数 ===
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // === 暴露API ===
  window.StarCoreShop = {
    init: function () {
      loadCoins();
      loadPass();
      loadSkins();

      const shopBtn = document.getElementById('shopBtn');
      if (shopBtn) shopBtn.addEventListener('click', () => {
        renderShop();
        document.getElementById('shopOverlay').classList.remove('hidden');
      });
      const shopCloseBtn = document.getElementById('shopCloseBtn');
      if (shopCloseBtn) shopCloseBtn.addEventListener('click', () => {
        document.getElementById('shopOverlay').classList.add('hidden');
      });
      const adBtn = document.getElementById('adBtn');
      if (adBtn) adBtn.addEventListener('click', () => {
        const rewardIndex = passData.active ? 2 : 0;
        showAd(rewardIndex, null);
      });

      if (passData.active) {
        const today = new Date().toISOString().slice(0, 10);
        if (passData.lastClaim !== today) {
          setTimeout(() => { toast('🎫 通行证今日奖励可领取！'); }, 500);
        }
      }

      console.log('[Shop] Initialized in ' + (isNative ? 'Native' : 'H5') + ' mode');
    },
    getCoins: () => coins,
    addCoins,
    spendCoins,
    showAd,
    canRevive,
    doRevive,
    resetRevive,
    renderShop,
    claimPassDaily,
    isNative: () => isNative,
    CONFIG,
  };
})();
