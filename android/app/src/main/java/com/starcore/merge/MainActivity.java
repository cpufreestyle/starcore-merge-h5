package com.starcore.merge;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.webkit.WebViewClient;
import android.util.Log;
import android.widget.Toast;

import com.tapsdk.tapad.TapAdSdk;
import com.tapsdk.tapad.TapAdConfig;
import com.tapsdk.tapad.TapAdManager;
import com.tapsdk.tapad.TapAdNative;
import com.tapsdk.tapad.TapRewardVideoAd;
import com.tapsdk.tapad.AdRequest;

import com.tencent.mm.opensdk.openapi.IWXAPI;
import com.tencent.mm.opensdk.openapi.WXAPIFactory;
import com.tencent.mm.opensdk.modelpay.PayReq;

import org.json.JSONObject;
import org.json.JSONException;

/**
 * 合成星核 — 主 Activity
 * 
 * WebView 壳 + JavascriptInterface 桥接
 * H5 通过 window.AndroidBridge 调用：
 * - showRewardAd() → Dirichlet (TapADN) 激励视频
 * - payWechat(orderJson) → 微信支付
 * - payAlipay(orderInfo) → 支付宝支付
 * 
 * 广告 SDK: Dirichlet Ad SDK 4.2.8.0
 * 媒体 ID: 1104682
 * 推广位 ID: 1059505 (激励视频-竖屏)
 */
public class MainActivity extends Activity {

    private static final String TAG = "StarCore";
    
    // === Dirichlet 广告配置 ===
    private static final long MEDIA_ID = 1104682L;               // 媒体 ID
    private static final String MEDIA_NAME = "合成星核";          // 媒体名称
    private static final String MEDIA_KEY = "3eYKVEB0dywPMulSNuCwTuVqHqNKfmq54nvoil25WQBqv6kOVG9NxaNZoMNOua2C"; // 媒体密钥
    private static final long REWARD_SPACE_ID = 1059505L;       // 激励视频推广位 ID
    
    // === 支付配置 ===
    private static final String WX_APP_ID = "";                  // TODO: 微信开放平台 AppID
    private static final String ALIPAY_APP_ID = "";              // TODO: 支付宝应用 ID

    private WebView webView;
    private TapAdNative tapAdNative;
    private TapRewardVideoAd mRewardVideoAd;
    private IWXAPI wxAPI;
    private Handler mainHandler = new Handler(Looper.getMainLooper());

    // 广告回调结果（H5 通过 JS 轮询）
    private String adResult = ""; // "" | "completed" | "skipped" | "failed"
    private String payResult = ""; // "" | "success" | "cancel" | "failed"

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 初始化 Dirichlet 广告 SDK
        initTapAd();

        // 初始化微信 SDK
        if (!WX_APP_ID.isEmpty()) {
            wxAPI = WXAPIFactory.createWXAPI(this, WX_APP_ID, true);
            wxAPI.registerApp(WX_APP_ID);
        }

        // 创建 WebView
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        // 注入 JS 桥接
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        // 加载本地 H5 游戏
        webView.loadUrl("file:///android_asset/web/index.html");

        setContentView(webView);
    }

    /**
     * 初始化 Dirichlet (TapADN) 广告 SDK
     * 必须在 Application.onCreate 中初始化，这里简化处理
     */
    private void initTapAd() {
        TapAdConfig config = new TapAdConfig.Builder()
                .withMediaId(MEDIA_ID)              // 媒体 ID
                .withMediaName(MEDIA_NAME)          // 媒体名称
                .withMediaKey(MEDIA_KEY)            // 媒体密钥
                .enableDebug(true)                   // 调试模式（正式版设为 false）
                .shakeEnabled(true)                  // 摇一摇广告交互
                .build();
        
        TapAdSdk.init(this.getApplication(), config);
        tapAdNative = TapAdManager.get().createAdNative(this);
        
        // 请求广告权限
        TapAdManager.get().requestPermissionIfNecessary(this, true);
    }

    /**
     * 加载并展示 Dirichlet 激励视频广告
     */
    private void loadAndShowRewardAd() {
        if (tapAdNative == null || REWARD_SPACE_ID <= 0) {
            Log.w(TAG, "Dirichlet SDK 未初始化或推广位 ID 未配置");
            adResult = "failed";
            return;
        }

        adResult = "";

        // 创建广告请求
        AdRequest adRequest = new AdRequest.Builder()
                .withSpaceId(REWARD_SPACE_ID)       // 推广位 ID
                .withRewardName("星核币")            // 奖品名称
                .withRewardAmount(100)              // 奖品数量
                .withUserId(getOrCreateDeviceId())   // 用户 ID（用于 S2S 验证）
                .build();

        // 加载激励视频广告
        tapAdNative.loadRewardVideoAd(adRequest, new TapAdNative.RewardVideoAdListener() {
            @Override
            public void onError(int code, String message) {
                Log.e(TAG, "Dirichlet 广告加载失败: code=" + code + " msg=" + message);
                adResult = "failed";
                mainHandler.post(() -> {
                    Toast.makeText(MainActivity.this, "广告加载失败", Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onRewardVideoAdLoad(TapRewardVideoAd rewardVideoAd) {
                Log.d(TAG, "Dirichlet 广告加载成功");
                mRewardVideoAd = rewardVideoAd;
                // 可以在 onRewardVideoCached 中展示，体验更好
            }

            @Override
            public void onRewardVideoCached(TapRewardVideoAd rewardVideoAd) {
                Log.d(TAG, "Dirichlet 广告缓存完成，准备展示");
                mRewardVideoAd = rewardVideoAd;
                
                // 设置广告交互监听
                mRewardVideoAd.setRewardAdInteractionListener(new TapRewardVideoAd.RewardAdInteractionListener() {
                    @Override
                    public void onAdShow(TapRewardVideoAd ad) {
                        Log.d(TAG, "广告展示");
                    }

                    @Override
                    public void onAdClose(TapRewardVideoAd ad) {
                        Log.d(TAG, "广告关闭");
                        // adResult 由 onRewardVerify 或 onSkippedVideo 设置
                        if (adResult.isEmpty()) {
                            adResult = "completed"; // 默认视为完成
                        }
                    }

                    @Override
                    public void onVideoComplete(TapRewardVideoAd ad) {
                        Log.d(TAG, "视频播放完成");
                    }

                    @Override
                    public void onVideoError(TapRewardVideoAd ad) {
                        Log.e(TAG, "视频播放错误");
                        adResult = "failed";
                    }

                    @Override
                    public void onRewardVerify(TapRewardVideoAd ad, boolean rewardVerify, int rewardAmount, String rewardName, int code, String msg) {
                        Log.d(TAG, "奖励验证: verify=" + rewardVerify + " amount=" + rewardAmount + " name=" + rewardName + " code=" + code + " msg=" + msg);
                        if (rewardVerify) {
                            adResult = "completed";
                        } else {
                            adResult = "skipped";
                        }
                    }

                    @Override
                    public void onSkippedVideo(TapRewardVideoAd ad) {
                        Log.d(TAG, "跳过广告");
                        adResult = "skipped";
                    }

                    @Override
                    public void onAdClick(TapRewardVideoAd ad) {
                        Log.d(TAG, "广告点击");
                    }

                    @Override
                    public void onAdValidShow(TapRewardVideoAd ad) {
                        Log.d(TAG, "广告有效曝光");
                    }
                });
                
                // 展示广告
                mainHandler.post(() -> {
                    if (mRewardVideoAd != null) {
                        mRewardVideoAd.showRewardVideoAd(MainActivity.this);
                    }
                });
            }
        });
    }

    /**
     * 调起微信支付
     */
    private void payWechat(String orderJson) {
        if (wxAPI == null) {
            Log.e(TAG, "微信 SDK 未初始化");
            payResult = "failed";
            return;
        }

        try {
            JSONObject order = new JSONObject(orderJson);
            PayReq req = new PayReq();
            req.appId = order.getString("appid");
            req.partnerId = order.getString("partnerid");
            req.prepayId = order.getString("prepayid");
            req.nonceStr = order.getString("noncestr");
            req.timeStamp = String.valueOf(order.getLong("timestamp"));
            req.packageValue = order.getString("package");
            req.sign = order.getString("sign");
            
            wxAPI.sendReq(req);
            payResult = ""; // 等待回调
        } catch (JSONException e) {
            Log.e(TAG, "微信支付参数解析失败", e);
            payResult = "failed";
        }
    }

    /**
     * 调起支付宝支付
     */
    private void payAlipay(String orderInfo) {
        new Thread(() -> {
            try {
                // TODO: 实际调用支付宝 SDK
                // PayTask payTask = new PayTask(MainActivity.this);
                // Map<String, String> result = payTask.payV2(orderInfo, true);
                // String resultStatus = parseResult(result.get("result"));
                // if ("9000".equals(resultStatus)) payResult = "success";
                // else if ("6001".equals(resultStatus)) payResult = "cancel";
                // else payResult = "failed";
                
                Log.d(TAG, "支付宝支付: " + orderInfo);
                payResult = "success"; // 模拟成功
            } catch (Exception e) {
                Log.e(TAG, "支付宝支付异常", e);
                payResult = "failed";
            }
        }).start();
    }

    /**
     * 获取设备 ID（用于广告奖励验证）
     */
    private String getOrCreateDeviceId() {
        String deviceId = getSharedPreferences("starcore", MODE_PRIVATE)
            .getString("device_id", "");
        if (deviceId.isEmpty()) {
            deviceId = "dev_" + System.currentTimeMillis() + "_" + 
                (int)(Math.random() * 1000000);
            getSharedPreferences("starcore", MODE_PRIVATE)
                .edit().putString("device_id", deviceId).apply();
        }
        return deviceId;
    }

    /**
     * JS 桥接对象
     * H5 通过 window.AndroidBridge.xxx() 调用
     */
    private class AndroidBridge {
        
        @JavascriptInterface
        public void showRewardAd() {
            mainHandler.post(() -> loadAndShowRewardAd());
        }

        @JavascriptInterface
        public String getAdResult() {
            return adResult;
        }

        @JavascriptInterface
        public void resetAdResult() {
            adResult = "";
        }

        @JavascriptInterface
        public void payWechat(String orderJson) {
            mainHandler.post(() -> payWechat(orderJson));
        }

        @JavascriptInterface
        public void payAlipay(String orderInfo) {
            payAlipay(orderInfo);
        }

        @JavascriptInterface
        public String getPayResult() {
            return payResult;
        }

        @JavascriptInterface
        public void resetPayResult() {
            payResult = "";
        }

        @JavascriptInterface
        public String getDeviceId() {
            return getOrCreateDeviceId();
        }

        @JavascriptInterface
        public boolean isNative() {
            return true;
        }

        @JavascriptInterface
        public void showToast(final String message) {
            mainHandler.post(() -> 
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show()
            );
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (wxAPI != null) {
            wxAPI.detach();
        }
        super.onDestroy();
    }
}
