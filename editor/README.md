# dltxt editor

`dltxt editor` 是一款专为游戏汉化、文本翻译人员打造的**轻量级、跨平台双行文本编辑器**。

它基于高性能文本引擎开发，专门用来解决 VSCode 过于臃肿、插件安装繁琐的问题。如果你不想为了翻译几个文本就去折腾笨重的 VSCode 及其专属插件，那么 `dltxt editor` 就是为你量身定制的无缝替代品！

---

## ✨ 核心特性

### 📁 类似 VSCode 的工作区管理
* **文件夹秒开**：软件启动时会提示您选择一个游戏文本所在的文件夹，随后便会切入主界面。
* **经典布局**：左侧为直观的「文件浏览器」，右边为「文本编辑区域」。
* **多标签页 (Tabs)**：支持同时打开多个文本文件切换编辑。
* **无感自动保存**：在您**切换标签页 (Tab) 时，软件会自动保存**当前文件，再也不用担心断电或误关闭导致翻译丢失。同时支持常规的保存（Ctrl + S）与撤销（Ctrl + Z）。

### 🔒 智能双行锁定与高亮
* **格式自定义**：支持根据不同的游戏文本自定义原文和译文的匹配规则。
* **防误触锁定**：解析文本后，软件会自动对「原文行」和「译文行」进行颜色区分，并且**严格只允许您编辑译文部分**，彻底杜绝不小心改动原文导致文本错乱、游戏报错的惨剧。

### 🌐 远程术语、人称动态高亮
* **免去对词表烦恼**：支持连接汉化组的远程术语库。文本中出现的角色人称、特定术语会自动高亮显示。
* **悬浮提示 (Hover)**：当您将鼠标悬停在高亮的术语上时，会直接弹出浮窗，展示该词的**标准翻译和备注说明**。
* **自动同步**：软件每隔 **30 秒** 会自动在后台轮询更新，无需手动刷新即可实时获取汉化组最新的术语修正。

---

## 🛠️ 智能配置文件加载规则

为了实现“开箱即用”，软件设计了一套极为便利的配置导入逻辑。当您用软件打开一个文件夹时，它会按以下顺序检测：

1. **专属配置优先**：如果根目录下存在 `dltxt-editor-setting.json`，将直接应用。
2. **VSCode 插件无缝迁移**：如果找不到专属配置，软件会尝试读取 `.vscode/settings.json`（原 VSCode dltxt 插件的配置文件）。如果读到以下字段，将自动继承并覆盖默认规则：
   * `dltxt.core.originalTextPrefixRegex` $\rightarrow$ 原文正则
   * `dltxt.core.translatedTextPrefixRegex` $\rightarrow$ 译文正则
   * `dltxt.core.x.originalTextWhite` / `translatedTextWhite`
   * `dltxt.core.y.originalTextSuffix` / `translatedTextSuffix`
   * `dltxt.core.name.regex` $\rightarrow$ 人称术语正则
3. **保底默认配置**：如果以上两个文件都不存在，软件将自动应用一套内置的标准星号/方块文本正则配置，并自动在根目录下创建 `dltxt-editor-setting.json` 供您后续微调。

---

## 🔗 如何连接远程术语库？

本编辑器目前支持连接单个远程术语库（Remote-URL 模式）。

想要开启术语高亮，只需要在术语库设置中填写simpletm共享链接即可（"simpletm://协议/服务器地址/用户名/API令牌/游戏项目名"）


# build
dotnet build
# publish
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true  -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -p:DebugSymbols=false