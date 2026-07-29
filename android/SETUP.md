# 合成星核 — Android 打包配置指南

## 架构

```
H5 游戏 (JavaScript)  ←→  AndroidBridge (JavascriptInterface)  ←→  Android Native
                                                                    ├── Dirichlet (TapADN) 广告 SDK
                                                                    ├── 微信支付 SDK
                                                                    └── 支付宝 SDK
```

## 已配置信息

| 配置项 | 值 | 来源 |
|--------|-----|------|
| 广告平台 | Dirichlet (TapADN) | ssp.dirichlet.cn |
| 媒体 ID | 1104682 | Dirichlet 后台创建 |
| 媒体名称 | 合成星核 | — |
| 媒体密钥 | 3eYKVEB0dywPMulSNuCwTuVqHqNKfmq54nvoil25WQBqv6kOVG9NxaNZoMNOua2C | Dirichlet 后台查看 |
| 推广位 ID | 1059505 | 激励视频-竖屏 |
| 推广位属性 | 测试 | 资质审核通过后切换为正式 |

## 运行模式

| 模式 | 触发条件 | 广告 | 充值 |
|------|----------|------|------|
| Native | 在 Android APK 内运行 | Dirichlet 原生激励视频 | 微信/支付宝原生支付 |
| H5 | 在浏览器/TapTap WebView 内运行 | 5秒模拟广告 | 模拟支付（需服务端支持真实支付） |

### 自动检测
`shop.js` 通过 `window.AndroidBridge.isNative()` 检测运行环境，自动切换模式。

## SDK 依赖

### Dirichlet Ad SDK 4.2.8.0

1. 从 https://ssp.dirichlet.cn/docs/dirichlet-sdk/sdk-guide/ 下载 `dirichlet_ad_4.2.8.0.aar`
2. 放入 `android/app/src/main/libs/` 目录
3. build.gradle 已配置 flatDir 仓库

### 还需配置的 ID

#### 微信支付（`MainActivity.java`）
```java
private static final String WX_APP_ID = "your_wechat_app_id";  // 微信开放平台 AppID
```

获取方式：
1. 登录 https://open.weixin.qq.com/
2. 管理中心 → 移动应用 → 创建应用 → 获取 AppID
3. 需要绑定包名 `com.starcore.merge` 和应用签名

#### 支付宝（`MainActivity.java`）
```java
private static final String ALIPAY_APP_ID = "your_alipay_app_id";  // 支付宝应用 ID
```

获取方式：
1. 登录 https://open.alipay.com/
2. 开发者中心 → 我的应用 → 创建应用 → 获取 AppID

## JS Bridge 接口

H5 通过 `window.AndroidBridge` 调用以下方法：

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `isNative()` | 无 | `boolean` | 检测是否在原生壳内 |
| `showRewardAd()` | 无 | void | 展示 Dirichlet 激励视频 |
| `getAdResult()` | 无 | `""\|"completed"\|"skipped"\|"failed"` | 获取广告结果 |
| `resetAdResult()` | 无 | void | 重置广告结果 |
| `payWechat(orderJson)` | 微信支付参数 JSON | void | 调起微信支付 |
| `payAlipay(orderInfo)` | 支付宝订单信息 | void | 调起支付宝支付 |
| `getPayResult()` | 无 | `""\|"success"\|"cancel"\|"failed"` | 获取支付结果 |
| `resetPayResult()` | 无 | void | 重置支付结果 |
| `getDeviceId()` | 无 | `string` | 获取设备 ID |
| `showToast(msg)` | 消息文本 | void | 显示原生 Toast |

## 打包步骤

### 前提条件
- Android Studio (或 Gradle 命令行)
- JDK 11+
- Android SDK 34
- 下载 `dirichlet_ad_4.2.8.0.aar` 放入 `app/src/main/libs/`

### 方法一：Android Studio
1. 打开 Android Studio
2. Open → 选择 `taptap-game/android/` 目录
3. 配置 `MainActivity.java` 中的微信/支付宝 ID（广告已配好）
4. Build → Generate Signed Bundle/APK → Build APK

### 方法二：Gradle 命令行
```bash
cd taptap-game/android
./gradlew assembleRelease
# APK 输出: app/build/outputs/apk/release/app-release.apk
```

## TapTap 上传

打包出 APK 后：
1. 登录 TapTap 开发者后台
2. 创建新版本 → 上传 APK 文件
3. APK 版本会替代当前的 H5 包体
4. 填写更新日志：v2.0 — 新增原生广告和支付功能

## 文件结构

```
taptap-game/
├── android/                    # Android 壳项目
│   ├── app/
│   │   ├── build.gradle         # 模块配置（Dirichlet/微信/支付宝依赖）
│   │   ├── proguard-rules.pro   # 混淆规则
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       ├── libs/
│   │       │   └── dirichlet_ad_4.2.8.0.aar  # 需下载放入
│   │       ├── assets/web/      # H5 游戏文件（打包时自动加载）
│   │       ├── java/com/starcore/merge/
│   │       │   ├── MainActivity.java      # 主 Activity + JS Bridge
│   │       │   └── WXPayEntryActivity.java # 微信支付回调
│   │       └── res/
│   │           ├── values/styles.xml
│   │           └── xml/
│   │               ├── file_paths.xml
│   │               └── network_security_config.xml
│   ├── build.gradle             # 项目配置
│   ├── settings.gradle
│   └── gradle.properties
├── js/
│   ├── game.js                  # 游戏核心逻辑
│   ├── shop.js                  # 付费系统 v3（原生桥接 + H5 fallback）
│   └── audio.js
├── css/style.css
├── index.html
└── store/                       # TapTap 素材资源
```

## 后续步骤

1. **下载 AAR 文件**：从 Dirichlet 文档页面下载 `dirichlet_ad_4.2.8.0.aar`
2. **配置支付**：在微信/支付宝开放平台创建应用，获取 AppID
3. **打包 APK**：使用 Android Studio 或 Gradle 构建
4. **测试广告**：在测试设备上验证激励视频广告加载和展示
5. **上传 TapTap**：将 APK 上传到 TapTap 开发者后台
6. **Dirichlet 验收**：通过测试工具添加测试设备，完成验收
7. **切换正式**：资质审核通过后，将媒体和推广位属性切换为正式
