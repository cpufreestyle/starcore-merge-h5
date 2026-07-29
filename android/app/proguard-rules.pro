# ProGuard 规则 — 合成星核

# Dirichlet (TapADN) SDK — 已内置 consumerProguardFiles，这里补充自定义规则
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn com.tapsdk.tapad.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase
-keepattributes JavascriptInterface
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-keep class * implements android.os.Parcelable { public static final android.os.Parcelable$Creator *; }
-keepclassmembers class * extends com.tapsdk.tapad.protobuf.GeneratedMessageLite { <fields>; }
-keepnames class * extends com.tapsdk.tapad.protobuf.GeneratedMessageLite
-keepnames class * extends com.tapsdk.tapad.protobuf.GeneratedMessageLite$Builder
-keeppackagenames com.tapsdk.tapad.**

# 微信 SDK
-keep class com.tencent.mm.opensdk.** { *; }
-keep class com.tencent.wxop.** { *; }
-keep class com.tencent.mm.sdk.** { *; }
-dontwarn com.tencent.mm.opensdk.**

# 支付宝 SDK
-keep class com.alipay.android.app.** { *; }
-keep class com.alipay.sdk.** { *; }
-dontwarn com.alipay.sdk.**

# Gson
-keep class com.google.gson.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
