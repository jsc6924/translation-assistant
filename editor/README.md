# dltxt editor
这是一个轻量级跨平台双行文本编辑器。使用c# (.net 9.0) Avalonia + AvalonEdit 实现。用于给不愿意安装笨重的vscode+dltxt插件的翻译使用。你需要参考dltxt的实现，在这个编辑器中实现一些dltxt的基础功能：
## 基础的编辑器功能
- 用户启动时，先让用户选择一个文件夹打开，然后切换到主界面
- 主界面类似vsocde，左边有一个文件浏览器，右边是文本编辑区域，用户能打开文件，可以开多个tab，有基本的保存、撤销功能
- 在切换tab时自动保存
## 双行文本高亮、编辑控制
- 让用户可以设置双行文本格式
- 在设置完格式后，使用DocumentParser解析文本，对原文和译文行的颜色进行区分，并只允许用户编辑译文部分。
- 双行文本格式、DocumentrParser的实现，请参考parser.ts

## 术语和人称高亮
现在我要实现术语高亮功能，也就是从服务器获取术语和人称信息，在文本编辑器中将那些术语高亮，当鼠标hover的时候，显示对应翻译和备注。
dltxt插件支持三种术语库：remote，remote-url，local，但是editor只需要支持remote-url即可。
dltxt支持连接多个术语库，但editor只需要支持连接一个。
dltxt有treeview显示和编辑术语和人称，editor暂时不需要这个界面，目前只需要从服务器获取术语并显示即可。
dltxt支持用websocket实时获取服务器推送的术语更新，editor暂时不需要支持，每30秒轮询一次即可。

当前 editor 使用工作区根目录下 `dltxt-editor-setting.json` 的 `simpleTmSharedUrl` 字段连接远程术语库（`simpletm://protocol/host/username/apiToken/gameTitle`）。

如果用户打开的目录里面有dltxt editor settings json则直接应用。如果没有dltxt editor settings json，则把"parserConfig": {
    "OriginalPrefixRegex": "\u2605[A-Za-z0-9]\u002B\u2605",
    "TranslatedPrefixRegex": "\u2606[A-Za-z0-9]\u002B\u2606",
    "OriginalWhiteRegex": "\\s*[\u300C]?",
    "TranslatedWhiteRegex": "\\s*[\u300C]?",
    "OriginalSuffixRegex": "[\u300D]?",
    "TranslatedSuffixRegex": "[\u300D]?"
  } 这个作为默认配置，并且尝试读目录里的.vscode/settings.json文件（如果该文件存在），尝试从里面读取"dltxt.core.originalTextPrefixRegex"，"dltxt.core.translatedTextPrefixRegex"，"dltxt.core.x.originalTextWhite"，"dltxt.core.x.translatedTextWhite"，"dltxt.core.y.originalTextSuffix"，"dltxt.core.y.translatedTextSuffix", "dltxt.core.name.regex"，读到就覆盖当前默认配置。将这个结果应用并保存到当前文件夹。

# build
dotnet build
# publish
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true  -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -p:DebugSymbols=false