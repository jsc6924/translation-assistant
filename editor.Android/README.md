# dltxt editor for Android 📱

`dltxt editor` 安卓版是一款专为移动端（手机/平板）打造的轻量级双行文本编辑器。基于 **.NET 10.0 + Avalonia + AvalonEdit** 强力驱动，完美还原电脑端的核心翻译体验，让翻译人员无需忍受臃肿的 VSCode + 插件，随时随地在手机上展开翻译工作。

---

## 🚀 核心功能

* **跨平台核心联动**：完全继承桌面版的双行文本高亮解析、编辑控制（只允许修改译文行）、自动保存、撤销、术语高亮及远程轮询同步功能。
* **触屏黄金键位**：针对手机单手操作进行了极致优化，在屏幕核心操作区（黄金高度 40% 处）提供悬浮快捷键：
  * `✂ (左侧)`：快速删除至当前译文分段末尾。
  * `➔ (右侧)`：一键跳转到下一行已翻译/未翻译的目标行。
* **智能配置迁移**：启动时自动扫描工作区目录。如果没有 `dltxt-editor-setting.json`，会自动尝试兼容并提取该目录下的 `.vscode/settings.json`（VSCode 插件配置），实现免配置秒开工。

---

## 📥 安装与避坑指南 (重要)

由于安卓系统的特殊性，首次安装及传输请务必注意以下两点：

### 1. 微信/QQ 传输导致无法安装的解决办法
通过手机 QQ 或微信将 `.apk` 发送给他人时，国内流氓系统或腾讯机制会自动在文件名末尾强行加上一个 `.1`（变成 `dltxt-editor.apk.1`），导致系统无法识别安装。
* **解决办法**：打开手机自带的「文件管理」，在搜索框搜 `dltxt`，找到该文件长按选择「重命名」，**将末尾的 `.1` 删掉**，恢复为 `.apk` 结尾即可直接点击安装。或者让发送方在电脑上**压缩成 `.zip` 包**后再发送。

### 2. 真机首次启动一片空白？
本软件作为高度定制的开发者工具，需要深度扫描你指定的汉化文本文件夹。
* **系统限制**：在 **Android 11 至 Android 15 (包括小米 HyperOS 2 / POCO F7 系列)** 上，系统为了隐私，默认会**静音锁死**所有 App 的全盘访问权限。
* **正确姿势**：应用在首次启动时会弹出【权限申请说明】弹窗。请点击 **「去设置」**，系统会自动跳转到设置深处。请手动勾选 **「允许访问所有文件」**（或允许管理所有文件）。勾选后连按两次返回键回到 App，即可正常刷新出文件树。

---

## 🛠️ 配置文件逻辑 (与桌面版完全一致)

应用在打开你指定的汉化文件夹时，会按照以下优先级加载规则：

1. **读取专属配置**：尝试读取工作区根目录下的 `dltxt-editor-setting.json`。
2. **无专属配置时自动降级提取 (VSCode 兼容)**：
   若无上述文件，将自动应用内置的星号/方块文本默认正则配置，并同时尝试读取 `.vscode/settings.json`。若读到以下字段，将自动覆盖并应用到当前工作区，同时在根目录下自动生成 `dltxt-editor-setting.json` 供下次秒开：
   * `dltxt.core.originalTextPrefixRegex` $\rightarrow$ 原文正则
   * `dltxt.core.translatedTextPrefixRegex` $\rightarrow$ 译文正则
   * `dltxt.core.x.originalTextWhite` / `translatedTextWhite`
   * `dltxt.core.y.originalTextSuffix` / `translatedTextSuffix`
   * `dltxt.core.name.regex` $\rightarrow$ 人称术语正则

---

## 🌐 术语和人称高亮 (Remote-URL)

安卓版支持连接单个远程术语库进行每 **30 秒** 的自动轮询同步：
* 请确保正确填写你的远程地址：
  `simpletm://protocol/host/username/apiToken/gameTitle`
* **交互体验**：同步成功后，文本区域内的特定术语和人称会高亮显示。在手机屏幕上**长按或手指悬浮 (Hover)** 在高亮词汇上，会弹出浮窗展示对应的翻译和备注，方便随时对齐名词。

---

## 📦 技术栈与编译要求

* **Framework**: Avalonia Framework (Nuget: 11.x+)
* **Editor Core**: AvalonEdit (Avalonia 适配版)
* **Runtime**: .NET 10.0 (net10.0-android)
* **Minimum Android Version**: Android 11.0 (API 30) 及以上。低于该版本的旧设备由于缺乏原生所有文件管理 API 无法运行。


# build
dotnet build .\editor.Android\editor.Android.csproj -c Debug
dotnet build .\editor.Android\editor.Android.csproj -c Release