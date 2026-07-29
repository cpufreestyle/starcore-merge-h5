package com.starcore.merge;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.tencent.mm.opensdk.openapi.IWXAPI;
import com.tencent.mm.opensdk.openapi.WXAPIFactory;
import com.tencent.mm.opensdk.modelbase.BaseReq;
import com.tencent.mm.opensdk.modelbase.BaseResp;
import com.tencent.mm.opensdk.openapi.IWXAPIEventHandler;
import com.tencent.mm.opensdk.modelpay.PayResp;

/**
 * 微信支付回调 Activity
 * android:scheme="starcore_wx" 在 AndroidManifest 中配置
 */
public class WXPayEntryActivity extends Activity implements IWXAPIEventHandler {

    private static final String TAG = "WXPay";
    private IWXAPI api;
    private static String lastPayResult = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        String wxAppId = MainActivity.class.getSimpleName(); // 占位
        // 从 SharedPreferences 获取微信 AppID
        String appId = getSharedPreferences("starcore", MODE_PRIVATE)
            .getString("wx_app_id", "");
        
        if (appId.isEmpty()) {
            Log.e(TAG, "微信 AppID 未配置");
            finish();
            return;
        }

        api = WXAPIFactory.createWXAPI(this, appId, false);
        api.handleIntent(getIntent(), this);
    }

    @Override
    public void onResp(BaseResp resp) {
        Log.d(TAG, "微信支付回调: errCode=" + resp.errCode + " errStr=" + resp.errStr);
        
        if (resp.getType() == 5) { // ConstantsAPI.COMMAND_PAY_BY_WX
            PayResp payResp = (PayResp) resp;
            switch (resp.errCode) {
                case BaseResp.ErrCode.ERR_OK:
                    lastPayResult = "success";
                    break;
                case BaseResp.ErrCode.ERR_USER_CANCEL:
                    lastPayResult = "cancel";
                    break;
                default:
                    lastPayResult = "failed";
                    break;
            }
        }
        
        // 通过 SharedPreferences 传递结果给 MainActivity
        getSharedPreferences("starcore", MODE_PRIVATE)
            .edit()
            .putString("pay_result", lastPayResult)
            .apply();
        
        finish();
    }

    @Override
    public void onReq(BaseReq req) {
        // 不处理
    }

    public static String getLastPayResult() {
        return lastPayResult;
    }

    public static void resetPayResult() {
        lastPayResult = "";
    }
}
