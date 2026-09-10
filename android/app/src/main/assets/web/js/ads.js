/**
 * 合成星核 — H5 激励视频广告适配器（优量汇 GDT H5 SDK）
 *
 * 默认未配置广告位 → StarAds.showRewardAd() 返回 false，
 * js/shop.js 会继续走内置模拟广告，行为与未接入时完全一致。
 *
 * 接入方式：在 index.html 中引入 js/ads.js 之前声明广告位：
 *   <script>window.AD_CONFIG = { ylhAppId: '110xxxxxxx', ylhSlotId: 'xxxxxxxx' };</script>
 * 广告位 ID 从优量汇后台「H5 广告 → 获取 JS 代码」获取，接入细节以官方文档为准。
 *
 * 官方文档：https://developers.adnet.qq.com/doc/web/js_develop
 */
(function () {
  'use strict';

  var cfg = window.AD_CONFIG || {};
  var configured = !!(cfg.ylhAppId && cfg.ylhSlotId);
  var adShowing = false;
  var pending = null; // { onReward, onDone }

  function loadSdk() {
    if (document.querySelector('script[src*="qzs.qq.com"]')) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = '//qzs.qq.com/qzone/biz/res/i.js';
    (document.head || document.getElementsByTagName('head')[0]).appendChild(s);
  }

  // SDK 通过 push 队列接收广告位配置，加载完成后依次处理
  function register() {
    window.TencentGDT = window.TencentGDT || [];
    window.TencentGDT.push({
      placement_id: cfg.ylhSlotId,
      app_id: cfg.ylhAppId,
      type: 'rewarded',
      rewardedCallback: function (res) {
        adShowing = false;
        var ok = !!(res && res.code === 0);
        if (pending) {
          if (ok && pending.onReward) pending.onReward();
          if (pending.onDone) pending.onDone(ok);
          pending = null;
        }
      },
    });
    loadSdk();
  }

  window.StarAds = {
    configured: function () { return configured; },

    /**
     * 发起真实激励视频
     * @param {Function} onReward - 完整观看后发放奖励
     * @param {Function} onDone - 结束回调（参数：是否完整观看）
     * @returns {boolean} true=已发起，结果走回调；false=未配置或正忙，调用方应使用模拟广告
     */
    showRewardAd: function (onReward, onDone) {
      if (!configured || adShowing) return false;
      adShowing = true;
      pending = { onReward: onReward, onDone: onDone };

      // 不同 SDK 版本的播放入口不同，逐个探测，均未就绪时依赖 push 配置自动播放
      try {
        var gdt = window.TencentGDT;
        if (gdt && gdt.TIVE && typeof gdt.TIVE.loadAd === 'function') {
          gdt.TIVE.loadAd();
        } else if (gdt && gdt.NATIVE && typeof gdt.NATIVE.loadAd === 'function') {
          gdt.NATIVE.loadAd();
        }
      } catch (e) { /* SDK 未就绪时忽略，等待 rewardedCallback */ }

      // 兜底：30 秒无回调视为加载失败，避免广告流程卡死
      setTimeout(function () {
        if (!adShowing) return;
        adShowing = false;
        if (pending) {
          if (pending.onDone) pending.onDone(false);
          pending = null;
        }
      }, 30000);

      return true;
    },
  };

  if (configured) register();
})();
