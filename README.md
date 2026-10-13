# 短线单

给普通股票账户用的短线名单。一次看十支沪深主板股票，可以按预计盈亏、一手成本、把握、涨跌幅排序。安装到手机后，行情由手机自己向公开接口拉取，大约每 15 秒刷新报价。

价差按 1 手、扣过佣金和印花税估算。把握按到价空间、止损空间和当天强弱估算，不是历史胜率，也不是收益承诺。当天买入，最早下一个交易日才能卖。

## 目录

- `phone/` 页面和选股逻辑
- `android/` 把页面打进安卓安装包

## 检查逻辑

```bash
npm test
```

## 生成单页

```bash
npm run build:page
```

生成 `phone/短线单.html`，用手机浏览器打开即可。

## 打安卓包

需要 JDK 17 和 Android SDK（platform 34、build-tools）。

```bash
set JAVA_HOME=C:\Path\To\jdk-17
set ANDROID_HOME=C:\Path\To\android-sdk
npm run build:apk
```

安装包写到项目根目录的 `短线单.apk`。用微信发到安卓手机后安装。签名用本机自动生成的调试证书，证书不进仓库。
