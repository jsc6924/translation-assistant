# DLTXT：双行文本翻译解决方案 v3

文字游戏汉化时通常会采用一种叫“双行文本”的格式。这种格式没有固定的语法，但是大多数符合以下特征
```
<原文标签1>原文1
<译文标签1>译文1

<原文标签2>原文2
<译文标签2>译文2
```
本项目作为Visual Studio Code的插件为以上格式的双行文本的翻译校对提供全套解决方案，提高工作效率，减少错误，减少不必要的重复劳动

**[视频教程（v2.21）](https://www.bilibili.com/video/BV1Sh4y1R7ii/)**

**[视频教程（v2.22 - v3.3）](https://www.bilibili.com/video/BV1xs4y167Ka/)**

**[视频教程（v3.4 - v3.25）](https://www.bilibili.com/video/BV1BDWKeiEyf/)**

## 目录
- [基本使用流程](#基本使用流程)
- [格式支持](#格式支持)
- [语法高亮](#语法高亮)
- [侧边栏UI](#侧边栏UI)
- [错误与警告](#错误与警告)
- [键盘快捷键](#键盘快捷键)
- [单文本批量操作](#单文本批量操作)
- [多文本批量操作](#多文本批量操作)
- [联网查词](#联网查词)
- [术语库](#术语库)
- [翻译数据库](#翻译数据库)
- [编程批量操作](#编程批量操作)
- [其他](#其他)

## 基本使用流程
1. 安装vscode编辑器
2. vscode插件市场中搜索dltxt并安装
3. 使用vscode打开你的项目**所在的文件夹**，不要单独打开一个文件。每个项目都需要使用一个不同的窗口打开。换句话说，不要用同一个窗口打开格式不同的文本。
4. 识别格式（往后看）

## 格式支持

**没有识别格式的情况下，只能使用一部分功能**

懒得读的直接看[自动设置](#自动设置)

DLTXT支持的格式可分为两种：标准双行格式、段落格式。

### 标准双行格式
标准双行格式的定义为：每一行仅通过行首的内容（标签）即可区分是原文还是译文。原文和译文必须按一行原文一行译文的顺序排列。原文和译文之间可以空行，或插入别的东西（注释等）。

大致格式如下：
```
[原文标签a]原文1
[译文标签a]译文1

[原文标签b]原文2
[译文标签b]译文2

#除了原文和译文之外，可以再添加其他内容，如注释等，只要能和原文译文区分即可（比如这里使用#开头）

[原文标签c]原文3
[译文标签c]译文3

```
其中标签可以是任意格式，并且原文和译文只需要一个有标签即可。

#### 默认支持的标准双行格式
标准双行格式中存在着一些几乎无需配置就能直接使用的格式。

DLTXT默认支持以下格式（用横线隔开）
```
★00000002★ 原文
☆00000002☆ 译文
－－－－－－－－－－－－－－－－－－－
○000000○ 原文
●000000● 译文
－－－－－－－－－－－－－－－－－－－
◇000000◇ 原文
◆000000◆ 译文
－－－－－－－－－－－－－－－－－－－
★scn00000★ 原文（标题）
☆scn00000☆ 译文（标题）

★nme00001★ 原文（人名）
☆nme00001☆ 译文（人名）

★txt00002★ 原文（文本）
☆txt00002☆ 译文（文本）
－－－－－－－－－－－－－－－－－－－
[0x00000000] 原文
;[0x00000000] 译文
－－－－－－－－－－－－－－－－－－－
<0>//Name: 原文（人名）
<0>Name:译文（人名）
<1>//原文
<1>译文
```

如果你的文本不属于其中的任意一种，则需要配置原文和译文前的标签格式才能使用。

可以选择如下两个方法之一进行设置。正确设置后除语法高亮外的其他功能均可正常使用。

#### 自动设置
1. 打开一个文本，在编辑器中右键（光标位置不要太接近文档结尾），点击DLTXT->自动识别文本格式
2. 它会让你输入几个既不属于原文又不属于译文的行，例如下面的`@1`，如果没有的话直接回车就行
```
@1
//原文
译文
```
3. 全部输入完毕后，会出现一个确认框，确认无误后点击“是”即可应用设置。

注：自动设置目前只配置必填项目，选填项目仍需手动设置。

#### 手动设置
如果自动设置失败，请按如下步骤操作（需要熟悉正则表达式）
1. 左下角打开设置（Settings），搜索dltxt
2. 填写原文开头标签的正则表达式`Original Text Prefix Regex`和译文开头标签的正则表达式`Translated Text Prefix Regex`
3. 如果有除了原文和译文以外的文本（比如控制语句等），填写`Other Prefix Regex`
4. 如果想自定义标签和正文之间的部分，或正文的后缀，可修改`*TextWhite`和`*TextSuffix`

### 段落格式
段落格式的定义为，需要通过上下文才能判断当前行是原文还是译文的格式。文本中可以见到重复出现的格式相同的段落。每个段落中必须有且只有一行原文和一行译文，顺序随意。两个段落不能共用一行。段落的行数可以变化。

例如：
```
-----------------------------0000-----------------------------
**
原文1[rt2]
=========
译文1[rt2]
-----------------------------0001-----------------------------
【说话人】
「原文2」[rt2]
=========
「译文2」[rt2]  
```
这种格式原文译文前都没有标签，因此只能通过段落中的相对位置判断。

**要使用段落格式，需要先在设置中把Document Parser（文本格式解析器）改为"text-block"**

之后，可以选择以下两个方法之一进行设置。

#### 自动设置
1. 打开一个文本，用光标选中一个段落。以上面那个格式为例，选中第1-5行（光标不要到第6行上面去）
2. 鼠标右键，选择DLTXT->自动识别文本格式 
3. 此时会弹出一个临时文件，内容类似这样
```
请把原文替换成【#JP#】，译文替换成【#CN#】
其他所有会变化的部分替换成【#ANY#】
如果变化的部分只包括字母或数字也可替换成【#ALPHA#】
替换结束后在右键菜单中选择“自动识别格式：继续”

<<<<<<<<<<不要动这行<<<<<<<<<<
-----------------------------0000-----------------------------
**
原文1[rt2]
=========
译文1[rt2]
>>>>>>>>>>也不要动这行>>>>>>>>>>
```
4. 按照上面的要求更改文件
```
<<<<<<<<<<不要动这行<<<<<<<<<<
-----------------------------【#ALPHA#】-----------------------------
【#ANY#】
【#JP#】[rt2]
=========
【#CN#】[rt2]
>>>>>>>>>>也不要动这行>>>>>>>>>>
```
5. 在临时文件上右键，选择DLTXT->自动识别格式：继续
6. 此时会弹出确认框，在确认无误后点击“是”即可

#### 手动设置
填写如下设置：
- Text Block: Pattern （段落的正则表达式） => 改为能匹配每个段落的正则表达式。其中原文部分和译文部分分别用命名捕获组`jp`和`cn`进行标注。

以上面的例子为例，可填
```
^-+\d+-+(\r)?\n((\*+)|(【.*】))(\r)?\n(?<jp>.*)(\r)?\n=+(\r)?\n(?<cn>.*)((\r)?\n)*$
```
- 选填`textBlock.*Prefix`,`*TextWhite`和`*TextSuffix`


## 语法高亮
  区分人名栏，原文，译文。基本只有使用默认支持的格式时才有效。（注：需要选择Theme：DLTXT Dark+/Light+）
  ![img1](https://github.com/jsc6924/translation-assistant/blob/master/imgs/1.png?raw=true)

## 侧边栏UI
![treeview](https://github.com/jsc6924/translation-assistant/blob/master/imgs/treeview.png?raw=true)

本插件自带一个侧边栏菜单。目前有以下子页面：

- 剪贴板
- 术语库
- 翻译数据库
- 设置与命令

以上功能将在之后的章节介绍

## 错误与警告
### 错误（可能会导致封包失败的问题）
可在设置中关闭，但不建议关闭
#### 检测被误删的标签
  ![img2](https://github.com/jsc6924/translation-assistant/blob/master/imgs/2.png?raw=true)

#### 检测被误删的译文/原文行
  ![img2](https://github.com/jsc6924/translation-assistant/blob/master/imgs/error-deleteline.png?raw=true)

### 警告（标点符号、错别字等问题）
#### 检测标点符号的使用
  ![punc-check](https://github.com/jsc6924/translation-assistant/blob/master/imgs/warning-punc-check.png?raw=true)

#### 检测非常用汉字
  ![unusual-char](https://github.com/jsc6924/translation-assistant/blob/master/imgs/warning-unusual-char.png?raw=true)

可在设置中单独关闭

如果想让某个汉字不再弹出警告，可把鼠标移到那个汉字上，点击警告界面弹窗中的Quick，再选择“不再显示这个汉字的警告”

  ![escape-char](https://github.com/jsc6924/translation-assistant/blob/master/imgs/warning-escape-char.png?raw=true)

如果想恢复不再显示警告的汉字，可使用“设置与命令”->“错误与警告”->“清除常用汉字警告白名单”

#### 检测错别字
  ![spellcheck](https://github.com/jsc6924/translation-assistant/blob/master/imgs/spellcheck.png?raw=true)

  手动检测译文的错别字，此功能需要连接百度智能云API（收费，不过很便宜），使用方法如下：

  1. 在百度智能云注册账号后开通“人工智能-自然语言处理-文本纠错”服务
      - 记得领取免费额度（个人用户50万次试用），顺便再充几块钱
  2. 在百度智能云中创建新应用，勾选自然语言处理全部功能，创建完成后会获取一对`Access Key`和`Serect Key`
  3. 在左侧侧边栏找到dltxt图标，点击，在`设置与命令`中找到`百度智能云API`，填写百度智能云的`Access Key`和`Serect Key`（输入后需要按回车）
  4. 打开你想检测的双行文本，在编辑器中右键，选择`DLTXT：译文错别字检查`即可
      - 译文每540字（程序会自动过滤人名行）发一个请求给百度云，检测一个1000句（大小100k左右）的双行文本大约需要15个请求，百度云文本纠错服务价格约为2元/千次请求，换算一下的话检测一个100k的文本大约3分钱。
  5. 如果想清除检测结果，在右键菜单选择`DLTXT：清除错别字检查结果`即可

#### 检查漏翻
需要手动操作，见“多文本批量操作”一节


## 键盘快捷键
在翻译文本时可使用键盘快捷键代替鼠标操作（注：可以在vscode设置中更改默认快捷键绑定）
快捷键分为普通模式（Normal）和翻译模式（Translate）。普通模式下可以正常打字，以及使用部分快捷键。翻译模式下能使用更多快捷键以及打出更多全角符号，但不能打出数字和部分半角符号。默认为普通模式，普通模式下使用`Alt + t`进入翻译模式。翻译模式下按`Esc`返回普通模式。

![demo](https://github.com/jsc6924/translation-assistant/blob/master/imgs/demo.gif?raw=true)

#### 默认快捷键绑定如下

| 快捷键 | 功能 | 支持的模式<1> |
|----------|----------|----------|
| `Alt + Enter` 或 `Ctrl + Enter`   | 移动到下一个译文行标签之后<2>  | N/T   |
| `Enter` | 同上 | T |
| `Alt + \` 或 `Ctrl + \`  | 移动到上一个译文行标签之后 | N/T |
| `\` | 同上 | T |
| `Ctrl + Alt + Space` | 将当前句的第一个字重复一遍并加一个逗号<3> | N/T |
| `Ctrl + Alt + Enter` | 将光标后的译文移动到下一行译文开头 | N/T |
| `Ctrl + Alt + \`  | 将光标前的译文移动到上一行译文结尾  | N/T |
| `Ctrl + Alt + .`  | 自动翻译某些特殊类型的句子 | N/T |
| `Ctrl + Alt + ,`  | 替换当前光标位置上的术语 | N/T |
| `Ctrl + Alt + m`  | 使用辞典服务器查询选中的内容 | N/T |
| `Alt + Backspace` | 删除光标后的译文直至标点符号 | N |
| `=` | 同上 | T |
| `Alt + Delete`  | 删除光标后的译文直至句尾（不包括句尾引号）| N/T |
| `Alt + Backspace`  | 同上 | T |
| `Alt + [` | 光标向左移动一格，当遇到省略号时移动两次 | N |
| `[` | 同上 | T |
| `Alt + ]` | 光标向右移动一格，当遇到省略号时移动两次 | N |
| `]` | 同上 | T |
| `Alt + [` | 首次使用：光标移动到左侧文本的中央，连续使用： 光标向左侧移动之前移动距离的一半 | T |
| `Alt + ]` | 首次使用：光标移动到右侧文本的中央，连续使用： 光标向右侧移动之前移动距离的一半 | T |
| `Shift + Alt + [` | 光标移动到当前短句句首  | N/T |
| `Shift + [` | 同上 | T |
| `Shift + Alt + ]` | 光标移动到当前短句句尾  | N/T |
| `Shift + ]` | 同上 | T |
| `Ctrl + Alt + [` | 光标移动到行首 | N/T |
| `Ctrl + [` | 同上 | T |
| `Ctrl + Alt + ]` | 光标移动到行尾 | N/T |
| `Ctrl + ]` | 同上 | T |
| `Alt + 1/2/3/4/5/6` | 黏贴第n号剪贴板<4> | N/T |
| `Ctrl + Alt + 1/2/3/4/5/6` | 把选中的文字复制到第n号剪贴板<4> | N/T |
| ``Shift + ` ``| 输入`～`| T |
| `1`| 输入 `！`| T |
| `2`| 输入 `♪`| T |
| `3`| 输入 `？`| T |
| `4`| 输入 `、`| T |
| `6`| 输入 `……`| T |
| `-`| 输入 `——`| T |
| `Space`| 输入全角空格  | T |
| `Alt + t`| 转到翻译模式 | N |
| `Escape`| 回到普通模式 | T |


<1>：N: 普通模式, T: 翻译模式

<2>: 例如这里的`|`的位置：`☆00000002☆「|`

<3>: 例`。是吗|，`->`。是、是吗|，`

<4>: 见下一节

#### 换行符

有些文本带有换行符。例如
```
●Text30●「ぐずぐずしていられないわ。\r\n　今朝は制服を着ないといけないもの。\r\n　慣れてなくて時間がかかるでしょうし」
○Text30○「可不能磨磨蹭蹭的呀。\r\n　毕竟今天要穿上校服了。\r\n　因为是第一次穿，还不习惯，估计会花不少时间」
```

其中`\r\n`是换行符。想让以上部分快捷键支持换行符，需要在设置`dltxt.nestedLine.Token`中填写换行符。换行符后面的空格不需要添加。

#### 剪贴板

插件自带了6个剪贴板，可以自由复制黏贴。

例：`Alt + 1`黏贴1号剪贴板的内容。`Ctrl + Alt + 2`把当前选中的文字复制到2号剪贴板（Workspace级别）。如果在执行`Ctrl + Alt + 数字`命令时没有选中任何内容，则会清空该剪贴板的Workspace级别的设置。

剪贴板的内容也可以在侧边栏中查看并修改。

剪贴板的默认设置为

| 编号 | 默认内容 |
|----------|----------|
| 1 |～|
| 2 |♪|
| 3 |♥|
| 4 |ー|
| 5 |『|
| 6 |』|

## 单文本批量操作

#### 文本格式化
右键菜单中选择`Format document`可以对译文进行格式化（不影响原文与标签），可根据设置完成以下任意功能：
  - 统一使译文开头的缩进以及对话首尾的括号（`「」`）与原文一致
  - 统一省略号（`"....", "。。。"　->　"……"`）(注1)
  - 统一波浪号（`~∼〜　-> ～`）(注1)
  - 统一破折号（`"ーーー", "－－－", "---"->"————"`）(注1)
  - 统一写反的、或半角的单引号、双引号　
  （`"英双"　“中双”　'英单'　‘中单’　”反的“　->　“英双”　“中双”　‘英单’　‘中单’　“反的”`）
  - 统一双引号（可选择“中文引号”或『日语引号』）
  - 将常用半角标点符号统一为中文全角标点（`,.:;!?() -> ，。：；！？（）“”`）
  - 将英文与数字统一为全角或半角（默认关闭）　（`123ABCdef <-> １２３ＡＢＣｄｅｆ`）
  - 去除对话句末的句号　（`。」-> 」`）
  - 把……。改成……
  - 把……？/……！改成？/！
  - 自定义翻译表（例如自动翻译人名）

![demo-format](https://github.com/jsc6924/translation-assistant/blob/master/imgs/demo-format.gif?raw=true)

注1: 可自定义想要统一成的符号

#### 提取、修改、应用译文
将双行文本中的译文单独提取，用户进行修改（如批量替换）后，再将改变的文本应用回去
  1. 打开双行文本，右键，选择`提取译文`
  2. 在右半窗口会显示提取的译文。完成修改之后，在右键菜单中选择 `应用译文至双行文本`，完成
  3. 注：上一步操作可使用`Ctrl + Z`撤销

![demo-extract](https://github.com/jsc6924/translation-assistant/blob/master/imgs/demo-extract.gif?raw=true)

#### 复制原文到未翻译的译文行
在右键菜单或命令框中选择“复制原文到未翻译的译文行”即可

#### 自动翻译某些特殊类型的句子
光标停在想要翻译的那行，按快捷键`ctrl+alt+.`
例：'あぁぁ' => '啊啊啊～'


## 多文本批量操作

### 批量检查译文
批量检查文本的标点、漏翻等问题。

1. 在文本内的右键，选择DLTXT->批量检查译文（或点击 侧边栏->设置与命令->错误与警告->批量检查译文）
2. 按照提示选择范围即可

想清除警告时，可使用 侧边栏->设置与命令->错误与警告->清除所有警告

### 在译文中批量替换
1. 选中一段文字，右键菜单中选择`批量替换选中的译文`
2. 按照提示选择范围即可

这个操作可撤销

### 批量自动添加换行符
1. 首先必须在设置中（`dltxt.nestedLine.token`）填写换行符
2. `dltxt.nestedLine.maxLen`可设置每行最大长度（默认28）
3. 点击 侧边栏->设置与命令->其他命令->自动插入换行符
4. 按照提示选择范围

这个操作可撤销

### 批量删除换行符
设置见上一节

点击 侧边栏->设置与命令->其他命令->删除换行符 即可

这个操作可撤销

### 批量修改文本编码格式
`Ctrl+Shift+P`，输入dltxt后选择`DLTXT：批量转换文件编码格式`即可使用。（在左侧explorer右键菜单中也能找到）

可以选择以下两个范围的文本：
1. 当前窗口已打开的所有文件
2. 当前窗口打开的文件夹内的所有文件（包括所有前缀不带'.'的子文件夹）
3. 当前窗口打开的文件夹内的所有文件（不包括子文件夹）

**注意选择第二、第三种范围转换后不可撤销，只能重新转换。转换之前请先备份。如果转换过程中出现任何问题导致文本丢失，本插件作者概不负责。**

选好范围以后根据提示选择文本原来的编码和想要转换到的编码就行了。任何一步不选择都会取消操作。

## 联网查词
本功能实现了联网查词的功能，默认使用MOJi辞书。dltxt不直接访问MOJi等网站，而是通过“辞典服务器”实现的接口，让辞典服务器去查询。这样做是为了减小本插件与可靠性低的爬虫代码之间的耦合。由于对网站的直接查询全部由辞典服务器实现，用户也可以自己编写服务器，使用自己喜欢的网站查词。

### 使用默认辞典服务器（MOJi辞书）

#### 快速使用

在文本中选中一个单词，右键后点击`使用辞典服务器搜索`即可

![dict-server-1](https://github.com/jsc6924/translation-assistant/blob/master/imgs/dict-server-1.png?raw=true)

初次使用时会下载默认的辞典服务器（MOJi辞书），约15M，并自动启动。如果提示下载失败，请尝试挂梯子，或在[这里](https://github.com/jsc723/moji-proxy-server/releases/tag/latest)手动下载并启动服务器。

如果系统询问是否同意网络连接，请点击同意。等待一会过后会显示搜索结果。

![dict-server-2](https://github.com/jsc6924/translation-assistant/blob/master/imgs/dict-server-2.png?raw=true)

下方弹出的窗口可以关闭。

使用以上的方式打开的服务器，在当前vscode窗口关闭时也会一起被关闭。

在服务器已经启动的情况下，选中一个单词，把鼠标移动到选中的内容上，会自动使用辞典服务器进行查询，并显示结果摘要。

![dict-server-6](https://github.com/jsc6924/translation-assistant/blob/master/imgs/dict-server-6.png?raw=true)

#### 登录MOJi

由于MOJi部分词汇语法需要登录后才能显示，默认辞典服务器可以使用以下方式登录。（不登录应该也不影响使用）

在设置中搜索`dltxt dict`，填写以下信息

![dict-server-4](https://github.com/jsc6924/translation-assistant/blob/master/imgs/dict-server-4.png?raw=true)

```
--username <MOJi辞书用户名> --password <密码> 
```

然后重启vsocde即可（如果服务器还没启动，不重启也可以）。
注意用户名和密码里都不能有空格，如果密码有空格请更改密码。
如果登录成功的话，可以在服务器显示的log中找到一行类似这样的

```
dict-server: 2024/01/07 11:42:00 Get session token = r:a2143f4302ef987895bad01cabcdc91b
```

#### 更新辞典服务器版本

由于MOJi官方没有公开API，如果目前API被更改会随时导致辞典服务器不可用，当这种情况发生时辞典服务器需要更新。更新前请先关闭当前辞典服务器，或者重启vscode。

如果想让vscode自动下载最新版本的默认辞典服务器，在侧边栏UI中，`设置与命令`->`辞典服务器`->`更新辞典服务器`。

手动更新请到[这里](https://github.com/jsc723/moji-proxy-server/releases/tag/latest)下载默认辞典服务器的最新版本（虽然最新版本如果没人更新，也可能用不了，不过MOJi好像也没有频繁更新API），下载后把文件路径填写到以下（用户）设置中

![dict-server-3](https://github.com/jsc6924/translation-assistant/blob/master/imgs/dict-server-3.png?raw=true)


### 使用自定义的服务器

你也可以使用任何喜欢的编程语言，自己实现辞典服务器，只要实现[默认辞典服务器](https://github.com/jsc723/moji-proxy-server)中定义的API即可。理论上可以使用任何查词网站，甚至使用本地辞典查词。

dltxt默认辞典服务器的端口号为9285，如果需要更改端口号，或者你的辞典服务器不在本地，可以更改以下设置

![dict-server-5](https://github.com/jsc6924/translation-assistant/blob/master/imgs/dict-server-5.png?raw=true)

在查询单词前运行你的辞典服务器即可。

## 术语库
### 简介
分为本地术语库和远程术语库。这个功能主要用于术语的翻译统一，打开文本时，术语库中存在的词语会显示高亮，并显示对应释义，来减少术语翻译不统一的情况。当使用远程术语库时，能使工作组中多人同时连接同一个术语库，以达到术语翻译同步的效果。


![SimpleTM](https://github.com/jsc6924/translation-assistant/blob/master/imgs/simpletm.png?raw=true)

![SimpleTM-UI](https://github.com/jsc6924/translation-assistant/blob/master/imgs/simpletm-ui.png?raw=true)

### 添加术语库
![SimpleTM-UI](https://github.com/jsc6924/translation-assistant/blob/master/imgs/dict-add.png?raw=true)

- 用vscode打开需要翻译的文本**所在的文件夹**
- 点击图中的按钮添加术语库
- 按提示选择本地/远程（详见下一节）
- 然后为术语库起一个名字（多个术语库名字不能相同）

#### 本地术语库
在新建的那个术语库下的连接设置中选一个路径即可

#### 远程术语库（SimpleTM）
支持两种模式访问
- 使用用户名+APIToken访问 (SimpleTM User)
  1. 访问SimpleTM服务器[simpletm.jscrosoft.com](https://simpletm.jscrosoft.com)并注册账号
  2. 在你的主页下方创建一个项目，项目名称不能和别人已经创建的项目重复，请尽量使用英文和数字
      - 如果你的组里还有其他组员需要加入当前项目，请在主页中点击项目名称，输入该组员的用户id，并给予其相应权限，点击`设置权限`即可。设置成功后，组员的主页中会显示该项目。（权限的具体解释见下一节）
      - 可以点击“分享链接”按钮获取一个URL，把URL分享给别人之后别人可以通过URL直接访问，不需要注册用户。生成URL将会生成一个虚拟用户，加入到你的项目中。别人使用URL访问项目时的权限等于那个虚拟用户的权限。如果把虚拟用户移出项目（权限设为无），则URL作废。
  3. vscode中添加术语库，选择“远程术语库 (SimpleTM User)”
  4. 远程术语库需要设置以下四项：
      - 服务器网址：默认为`https://simpletm.jscrosoft.com/`
      - 用户名：SimpleTM的账号名
      - APIToken：在你的SimpleTM主页中可以找到，复制黏贴即可
      - 项目名：第2步创建的项目名
- 使用别人分享的URL访问 (SimpleTM URL)
  1. 添加术语库，选择“远程术语库 (SimpleTM URL)”
  2. 在连接设置中填写URL即可


#### 远程术语库SimpleTM项目权限

  - 无：用户无权访问该项目
  - 只读：用户只能查寻词条，但不能对词条进行更新
  - 读写：用户可以读取词条、更新词条、增加新词条
  - 管理员：在读写权限的基础上，用户还能改变当前项目中其他用户的权限，并可以删除该项目

### 术语库使用
1. 设置好至少一个术语库后，打开一个文本，选中你想同步的词（原文），在右键菜单中，选择`添加术语库词条`
2. 如果想更改释义，选中文本，在右键菜单中，选择`更新术语库词条`，输入译文并回车即可。如果想删除词条，则什么都不输入直接回车。
3. 可以使用侧边栏的UI复制释义，也可以编辑、删除词条。

### 自定义高亮样式
在每个术语库下的“外观”可以自定义样式

### 批量导入导出

如图

![SimpleTM-IM-EX](https://github.com/jsc6924/translation-assistant/blob/master/imgs/simpletm-import-export.png?raw=true)

导入只支持将xlsx文件导入到本地术语库
读取xlsx的第一页中的前两列，第一列标题必须为key，第二列标题必须为value

导出时也是同样的格式，不过也能从远程术语库导出。

### 注意事项

1. 插件默认每隔300秒回自动同步云端词条，可在设置中修改默认间隔，也可使用dltxt侧边栏中的按钮手动同步
2. SimpleTM是开源的：[Github](https://github.com/jszhtian/SimpleTM)，如有需要可以自己搭服务器
3. 不管是本地还是远程，术语库的代码目前并没有为储存大量数据做过优化。因此不建议在术语库中储存超过一千条以上的数据。

## 翻译数据库
可以把翻译好的文本添加到翻译数据库。以后遇到类似的句子或者表达可以搜索数据库查找自己以前的翻译。
#### 使用场景
比如我在翻译过程中遇到了一个表达不太好翻译，我隐约记得我以前翻译过类似的表达，但是我记不清怎么翻的了。我可能以前参加过十几个甚至几十个项目，我也记不清到底是哪个项目的哪个文本用了这个表达。使用这个功能，我可以把我以前翻译过的项目的文本汇总到一个数据库中，建立索引。使用类似搜索引擎的技术进行快速搜索，且支持模糊检索，结果按相关度排序。这样在遇到一个表达的时候就可以迅速搜索以前类似的翻译，以供参考。
#### 使用方法
1. 确保文本格式识别正确（参考“格式支持”章节设置）
2. **重要**：设置中搜索`dltxt trdb`填写`File Encoding`（格式参考上一节中“常用的encoding”）和`Project`（相当于一个文件夹名，当前项目的文本会放入这个文件夹，防止多个项目间文件名冲突）
3. 如果文本内有其他代码，填写`Filtered Line`可在添加至数据库时过滤（例：`[A-Za-z0-9]+\.[A-Za-z0-9]+`）
4. 左侧文件资源管理器中，在文件或文件夹上右键，可看到“添加到翻译数据库”。如果添加文件夹，则会把文件夹下所有文件都添加到数据库（不支持多级目录）。
5. 如果将同项目中的同名文件添加到数据库中，会覆盖之前的内容。
6. dltxt侧边栏的translation db分页中可查看数据库中存在的文件，并且可以查看、删除文件或文件夹。
7. 第一次使用翻译数据库时，会自动下载分词器使用的词典（大约15MB）。如果下载失败，请手动从[这里](https://github.com/jsc6924/translation-assistant/raw/master/data/dict.zip)下载，并解压到`C:\Users\{你的用户名}\AppData\Roaming\Code\User\globalStorage\jsc723.translateassistant\dict`目录下
8. 在文本中选中一段文字右键，可以看到“在翻译数据库搜索单词”和“在翻译数据库搜索句子”。这两者的区别是：搜索单词时不会经过自动分词器，搜索句子时会，而且搜索句子时会开模糊匹配。搜索单词的时候也可以搜索多个单词，中间用空格隔开。


![trdb-search](https://github.com/jsc6924/translation-assistant/blob/master/imgs/trdb-search.png?raw=true)

#### 导入导出翻译数据库

![trdb-import](https://github.com/jsc6924/translation-assistant/blob/master/imgs/trdb-import.png?raw=true)

点击上图所示图标可导入、导出翻译数据库。导出的数据库被保存为一个zip文件。导入时读取zip文件，替换当前数据库。


## 编程批量操作

使用编程的方式对多个文本执行自定义的批量操作

### 游戏脚本与双行文本的转换操作(dlbuild)

这个功能可以从游戏脚本中提取原文并生成双行文本，在翻译完成后可以用译文将脚本中的原文替换。

使用这个功能需要在当前目录下定义一个配置文件`dlbuild.yaml`，格式如下
```yaml
extract: #配置提取操作
  input:
    path: './input/'   #游戏原脚本所在的文件夹
    encoding: 'shift-jis'   #游戏脚本使用的编码格式
    ext: 'ks'              #游戏脚本的后缀名，空字符串表示全部匹配
    digits: 5               #双行文本标签中数字的长度
    items:                  #配置想提取的文本，程序会一行行读取脚本并使用正则表达式匹配
      - capture: '@Talk .*?name=(\S+)'             #描述要提取的文本
        tag: 'nme'          #双行文本中标签的前缀
        group: 1                                   #注明要提取capture中的哪个group
      - capture: '@scene .*?text=(\S+)'
        tag: 'scn'
        group: 1
      - capture: '@AddSelect .*?text=(\S+)'
        tag: 'slt'
        group: 1
      - capture: '^\s*([^@\s].*)'
        tag: 'txt'
        group: 1
  output:
    path: './output/'    #提取出来的双行文本会保存到这里
    encoding: 'utf16le-bom' #双行文本使用的编码格式

pack: #配置替换操作
  input:
    path: './output/'  #翻译好的双行文本所在的文件夹，建议更改为一个与extract.output.path不同的文件夹
    encoding: 'utf16le-bom'
  output:
    path: './replaced/' #替换好的脚本会保存到这里
    encoding: 'utf16le-bom'

#常用的encoding: ['utf8', 'utf8-bom', 'utf16le', 'utf16le-bom', 'utf16be', 'utf16be-bom', 'shift-jis', 'gb2312', 'gbk'];
#*.input.encoding也可以填auto（自动识别）

```
以上例子描述了如何从krkr引擎的脚本中提取双行文本。

其中目录中的子目录都会被递归访问。

其中`encoding`除了以上列举的还包括iconv-lite库中支持的所有encoding。有'-bom'后缀的表示是带签名的。只在output.encoding中区分签名，在input.encoding中不区分有没有签名，且可以填'auto'（自动识别）。

#### 从游戏脚本中提取原文并生成双行文本（dlbuild.extract）
`Ctrl+Alt+P`: 搜索dlbuild，选择`将脚本提取为双行文本`即可（在左侧explorer右键菜单中也能找到）

注意这个过程会生成一些中间文件放到`./.dltxt/`目录下，如果删除这些中间文件会导致之后无法把翻译替换回去。如果误删请再次运行此命令恢复中间文件。

#### 用双行文本的翻译替换脚本中的原文 （dlbuild.pack）
`Ctrl+Alt+P`: 搜索dlbuild，选择`用双行文本的翻译替换脚本中的原文`即可（在左侧explorer右键菜单中也能找到）

### 多文本转换操作（dltransform）
与dlbuild相似，需要当前目录下有一个`dltransform.yaml`
#### 把多个文本连接为单个文本（dltransform.concat）
左侧explorer右键菜单中可找到

把每个子文件夹中的所有文本会被合并成一个文件

在`dltransform.yaml`中按以下格式填写即可：
```yaml
concat:
  input: 
    path: './input-folder'
    encoding: 'auto'
  output:
    path: './concated'
    encoding: 'utf16le-bom'
```

#### 字数统计（dltransform.wordcount）
左侧explorer右键菜单中可找到
配置格式：
```yaml
wordcount:
  input: 
    path: './input-folder'
```

#### 自定义文本操作（dltransform.transform）
可以实现文字的批量替换、删除等。（不能改变文件行数，不过可以新建文件）
有两种方法：第一种是在yaml配置文件中编写简单脚本，完成简单操作；第二种是编写JavsScript脚本，在yaml中制定脚本名和函数名
#### yaml中嵌入脚本
```yaml
transform:
  input: 
    path: './test'
  output:
    path: './transform-output'
    encoding: 'utf8'
  operations:
    - select: '@translation'
    - filter: $.text.length >= 8 || api.contains($.text, "[。！—…「」『』]")
    - exec:   $.text = api.clearExcept($.text, "[「」『』。？！～\x00-\x7F]")
    - commit: ''
    - end-select: ''
```
#### `select`

选择一个正则表达式，之后的每一行只有匹配了这个select的正则表达式才会被执行，直到下一个`select`或`end-select`为止。支持三个选项`@translation`,`@original`,`@other`，分别对应设置中的“译文开头标签的正则表达式”，“原文开头标签的正则表达式”，“其他合法开头的正则表达式”。如果不以`@`开头，可以在这里另外一个正则表达式。
如果选择了三个选项之一，那这些正则表达式执行的结果的groups属性里会有以下四个named group: `prefix`,`white`,`text`,`suffix`

具体定义如下

```javascript
new RegExp(`^(?<prefix>${jPreStr})(?<white>\\s*[「]?)(?<text>.*?)(?<suffix>[」]?${suffixStr})$`);
```

如果这里选择另外定义正则表达式，需要仿照上面定义那四个named group

#### `filter`
填写一个Javascript表达式，只有返回true才会执行后续，直到下一个`select`或`end-select`。表达式中可以使用特殊的`$`变量（=select的正则表达式执行后的match对象的groups），并且可以通过`api`对象使用插件提供的工具函数，具体列表见后面。

#### `exec`
同上，执行Javascript表达式

#### `commit`
执行`current line = $.prefix + $.white + $.text + $.suffix;`
没有这一条，不会更新文本。

#### 使用JavaScript脚本
使用`script.path`指定javascript脚本，所有要用到的函数都定义在这个脚本里
使用`operations.script`指定每一行读取后交给哪个函数处理。下面例子中的select和commit不是必须的。
`operations`可以省略，但是省略也会输出结果（与输入的文本一致）
`on-[global/file]-[begin/end]`指定了在执行开始、执行结束、文件开始、文件结束时运行的函数名，每个都可以省略
注意脚本在读取每本文本时会被重新加载，所以脚本中的全局变量只在当前文本有效。
要使用在整个执行期间都有效的全局变量，需要使用`vars`（看后面）
```yaml
transform:
  input: 
    path: './test'
  output:
    path: './transform-output'
    encoding: 'utf8'
  script:
    path: './my-script.js'
  operations:
    - select: '@translation'
    - script: 'clearChars'
    - commit: ''
  on-global-begin: 'onGlobalBegin'
  on-global-end: 'onGlobalEnd'
  on-file-begin: 'onFileBegin'
  on-file-end: 'onFileEnd'
```

举例
```javascript
function hello({line, lines, index}) {
    const [jreg, creg] = api.getRegex(); //提供的工具函数通过api对象调用
    if (creg.test(line)) {
        return line + api.getFileName();
    }
    return line + api.getFilePath();
}

function clearChars() {
    const g = api.getMatchedGroups(); //如果前面有select，则返回select执行的结果（等于前面的$）
    if (api.contains(g.text, "[。！—…「」『』]")) {
        g.text = api.clearExcept(g.text, "[「」『』。？！～\x00-\x7F]");
    }
    //如果有返回值相当于commit，如果没有则需要之后手动commit
    //return `${g.prefix}${g.white}${g.text}${g.suffix}`; 
}

const fs = api.fs;
function onGlobalBegin() {
    api.log("current directory: "+api.getRootDir());
    api.log("onGlobalBegin");
    vars.set("fileCount", 0);
    const f = fs.openSync(`${api.getRootDir()}/tmp.txt`, "w");
    vars.set("file", f);
}


function onGlobalEnd() {
    api.log("onGlobalEnd");
    api.log(`fileCount: ${vars.get("fileCount")}`);
    const f = vars.get("file");
    fs.closeSync(f);
}

function onFileBegin() {
    api.log("onFileBegin");
    vars.set("fileCount", vars.get("fileCount") + 1);
    const f = vars.get("file");
    fs.writeSync(f, api.getFileName() + "\n");
}

function onFileEnd() {
    api.log("onFileEnd");
}
```


#### 提供的工具函数列表
```javascript
getRegex(): [originalRegex : RegExp, translationRegex : RegExp, othersRegex : RegExp]
contains(line: string, what: string): boolean 
clear(target: string, what: string): string
clearExcept(target: string, except: string): string
getFileName(): string
getFilePath(): string
log(): void
getRootDir(): string //当前vscode打开的目录
encodeWithBom(content: string, encoding: string): Buffer //encoding参照之前章节
// 例：fs.writeFileSync(fOut, encodeWithBom(fOutStr, 'utf16le-bom'));
```
#### 可以使用的node.js自带的库
```javascript
//使用方法 const fs = api.fs;
fs
path
```
#### 读写全局变量
`vars: Map`的生命周期从on-global-begin之前开始，在on-global-end之后结束
```javascript
vars.set(string, any);
vars.get(string): any;
```



## 其他
#### 如何设置插件
1. 点击左下角设置按钮，点Settings
2. 在Settings的搜索栏中搜索dltxt
3. 搜索栏下方有一个User和Workspace选项，User是当前用户的设置，Workspace是当前文件夹（工作区）的设置，如果两个都填写了则会优先使用Workspace设置。所以建议与游戏有关的设置填写在Workspace中，与用户自己使用习惯等有关的设置填写在User中。

#### 使用建议
为了更好的体验，建议对vscode进行如下设置：

右下角打开设置`Settings`,
  1. 搜索 `auto save`, 把User的Files：Auto Save改为afterDelay（自动保存）
  2. 搜索 `font family`，把Workspace的Editor：Font Family设置成`SimHei`（黑体）

---
## 开发
```
npm run compile && npm run esbuild
vsce login <username of dev.azure.com>
vsce package
vsce publish
```

upgrade vscode api version
```
package.json
"engines": {
		"vscode": "^1.80.0"
},

npm install --save @types/vscode@1.80

```



count lines of code 
```
find ./src -type f -print0 | xargs -0 wc -l
```


---
## Release Notes
#### 3.30 (2024/10/27)
- 支持自动添加换行符
- 支持删除所有换行符
#### 3.29 (2024/10/19)
- 添加对换行符的支持
- 添加半角标点符号检查
#### 3.28 (2024/9/5)
- 非常用汉字检查
- 非常用汉字警告白名单
- 修复trdb没有escape html的bug（2024/9/23）
#### 3.27 (2024/8/31)
- 批量检查文本的问题并显示警告
- 修复批量处理时，选择“所有打开的文件”时范围不正确的bug
- 支持的最低vscode版本从v1.63升至V1.80
- typescript版本从v3.8升级至v5.5
- 去除了3.26版本添加的动态检查漏翻的功能
#### 3.26 (2024/8/28)
- 检查当前文本的标点符号问题、漏翻，并显示警告
#### 3.25 (2024/8/17)
- 实现光标的二分查找（`Alt+[` `Alt+]`）
- 编码转换和批量替换的范围可以选择当前文件夹下的所有文件但不包含子目录
- 修复从xlsx导入到术语库时，key为数字时无法加载插件的问题
- 修复更改术语高亮外观设置后没反应的问题
- 修复批量替换译文时，同一行中多处译文只被替换一处的bug
#### 3.24 (2024/8/5)
- 选中一段文字后，能在译文中批量替换（可撤销）
#### 3.23 (2024/8/2)
- 添加对amkn2新格式高亮支持
- 支持与本地术语库断开连接
#### 3.22 (2024/7/4)
- 添加dltransform功能
  - on-file-begin, on-file-end
  - on-global-begin, on-global-end
  - api.rootDir()
  - vars
  - api.fs, api.path, api.encodeWithBom()
- 以下操作前会事先检查文本格式是否有错
  - 翻译数据库添加文本、文件夹时
  - 提取、应用译文时
#### 3.21 (2024/3/25)
- dltransform支持输出log
#### 3.20 (2024/3/6-3/22)
- 可以把英数字统一为半角
- 优化了统一破折号的逻辑，修复问题
- 文本格式化添加对……。……？……！的统一
- 文本格式化暂时不支持统一空格
- 加强特殊翻译功能
#### 3.19 (2024/2/27)
- 添加导入导出术语库的功能
- 修复文本高亮的bug
#### 3.18 (2024/2/7-2/27)
- 修复百度智能云API Key能被其他插件直接读取的安全问题
- 把侧边栏标题改成了中文
- 重构了部分treeview的代码
- 可以手动关闭由vscode打开的辞典服务器
- 修复多窗口globalState不同步的问题
- 可以自定义术语高亮的边框半径
- 更新了文本高亮规则
- 添加了更新辞典服务器的命令
#### 3.17 (2024/2/3)
- 增加快捷键：替换当前光标位置上的术语
- 修复术语的替换功能（之前光标必须在同一行才有效）
- 对高亮的小修补
- 当错误太多不予全部显示时，显示Info而不是Error
#### 3.16 (2024/1/29)
- 段落格式支持自动识别格式
- 修复段落格式的一个bug
- 翻译数据库可以设置搜索结果最大显示条数
#### 3.15 (2024/1/29)
- 新增TextBlockDocumentParser，可支持“段落格式”的文本
  - 这种模式下除了暂时不能自动识别格式，其他功能均支持
- 重构AutoDetector
- 重构DocumentParser
- 修复了标准双行格式下自动识别格式不能处理原文和译文中的空行的bug
#### 3.14 (2024/1/28)
- 添加对后缀的支持
- 添加formatter的debug模式
- 修复formatter原文行和译文行必须相邻才能使用的bug（现在最多间隔4行）
- 修复padding的bug
- 重构文本剖析相关逻辑至parser
- 重构motion模块
- 重构singleline模块，提取单行文本操作不再支持自定义正则表达式
- 优化错误处理
#### 3.13 (2024/1/26)
- 支持自定义多文本处理，可以在yaml中编写简单脚本，也可以使用Javascript脚本
#### 3.12 (2024/1/8)
- 把选中一个词，把鼠标移动到上面会自动使用辞典服务器查词
- 添加默认辞典服务器Gitee下载源
#### 3.11 (2024/1/7)
- 给术语库TreeView添加筛选（查找）功能
- 更新TRDB翻译数据库搜索结果的WebView
#### 3.10 (2024/1/7)
- 增加辞典服务器查词功能
  - 默认使用MOJi查词
  - 自动下载辞典默认服务器
  - 用户可以自己实现服务器
  - 增加快捷键：`ctrl + alt + m` 查询选中内容
#### 3.9 (2023/11/29)
- 现在可以直接点击"replace"把术语替换为对应的翻译
#### 3.8 (2023/11/7)
- 可以使用SimpleTM共享URL(`simpletm://`)访问在线术语库
#### 3.7 (2023/11/6)
- 可以自定义每个术语库的高亮样式
- 术语库编辑词条时会显示之前的值
- 可以在侧边栏中直接添加侧条
#### 3.6 (2023/8/30)
- 支持批量导入xlsx至本地术语库
#### 3.5 (2023/7/12)
- dlbuild
  - 扫描文件夹时支持递归子目录
  - 支持自动识别encoding
- dltransform
  - concat：合并多个文本
#### 3.4 (2023/7/8)
- 自动翻译某些特殊类型的句子
#### 3.3 (2023/7/3)
- 增强自动识别格式
- 现在可以选择统一双引号时的样式
#### 3.2 (2023/7/2)
- 自动识别格式
- 错误检测
    - 检测删行错误
    - 更改了配置的格式
- 整理了右键菜单

#### 3.1 (2023/7/1)
- 支持本地术语库
#### 3.0 (2023/7/1)
- 重写术语同步模块，支持连接多个术语库
#### 2.34 (2023/6/29)
- 侧边栏支持翻译数据库
- 从翻译数据库中移除文件/文件夹和重新加载功能移动到侧边栏中
- 导入导出翻译数据库
- 修复多个窗口同时使用翻译数据库时的同步问题
- 提高提取/应用单行文本时的稳定性
- 可以查看翻译数据库中的文本内容（只读）
#### 2.33 (2023/6/28)
- 翻译数据库
  - 添加文件、文件夹
  - 删除文件
  - 检索单词、句子
#### 2.32 (2023/6/24)
- 剪贴板不再使用Configuration，改成使用ExtensionContext
- 侧边栏中可编辑剪贴板的内容
#### 2.31 (2023/6/24)
- 增强侧边栏功能，现在可以在侧边栏内复制、编辑、删除词条
- 可在侧边栏内手动同步SimpleTM数据库
- 可自定义SimpleTM数据库自动同步间隔
#### 2.30 (2023/6/21)
- 可在侧边栏中查看剪贴板内容
- 增加`[]`的快捷键
- 修复移动光标时遇到省略号的问题
#### 2.29 (2023/6/16)
- 可使用6个自定义剪贴板`Alt+(1-6)`
- 调整翻译模式部分快捷键
#### 2.28 (2023/6/14)
- 快捷键添加翻译模式
#### 2.27 (2023/6/13)
- 错别字检查可以设置跳过检查的字段
#### 2.26 (2023/6/8)
- 快捷键`Alt+1/2/3`：输入特殊字符（可自定义）
#### 2.25 (2023/6/4)
- 添加错别字检测功能
- 修复快捷键没有when的问题
#### 2.24 (2023/6/3)
- 为术语同步功能添加侧边栏
#### 2.23 (2023/6/2)
- 添加快捷键
  1. 移动到当前短句句首
  2. 移动到当前短句句尾
#### 2.22 (2023/6/2)
- 添加快捷键
  1. 区分删除整行、删除短句
  2. 移动到行首和行尾
- 修改了部分快捷键的命令名称（用户可能需要重新配置绑定）
#### 2.21 (2023/5/27)
- 快捷键：把光标后译文移动到下一行的同时会移动光标（默认开启，可在设置中关闭）
- 术语同步：可以点击复制翻译
#### 2.20 (2023/5/20)
- 支持带签名的Unicode编码转换
- 能一次处理多种后缀名的脚本
#### 2.19 (2023/5/19)
- 添加脚本文件相关操作
  1. 从脚本生成双行文本
  2. 把双行文本应用至脚本
#### 2.18 (2023/5/18)
- 添加文件编码格式批量转换功能
#### 2.17 (2023/5/17)
- 重写README
- 删除联网查词功能
#### 2.16 (2023/5/16)
- 支持多个文件的错误检测
- 智能识别双行文本的文件，不是双行文本不检测错误
- 更改设置后不需要reload
- 修复prevLine bug
- 修复关键词和错误高亮不能关闭的bug
#### 2.15 (2023/5/16)
- 把SimpleTM项目名放到了设置中
#### 2.14 (2023/5/16)
- 添加支持高亮的格式
- 添加错误检测
#### 2.13 (2023/5/14)
- 自定义翻译表
- 使用esbuild打包，提高加载速度
- 优化关键词显示样式
#### 2.12 (2023/5/13)
- 自定义skipchars前缀和deleteAllAfter后缀
#### 2.11 (2023/5/13)
- deleteAfterAll（删除光标后的翻译直到特定字符）
#### 2.10 (2023/5/13)
- 自定义省略号，破折号，波浪号
#### 2.9 (2023/5/11)
- 删除MOJi查词
- 优化部分算法
#### 2.8 (2021/2/14)
- 添加快捷键
- 修复MOJi

#### 2.7 (2020/10/6)
- 增加调整格式的快捷键

#### 2.6 (2020/9/27)
- MOJi辞書支持登录账号

#### 2.5 (2020/9/27)
- MOJi辞書

#### 2.4 (2020/9/19)
- 大幅提高文本格式化算法可靠性，解决了添括号时对『双层直角括号』处理不正确的问题（见formatter.adjust函数）
- 优化运行速度

#### 2.3 (2020/9/13)
- 快捷键`Ctrl+Alt+Space`：重复当前句子的第一个字
- 增加浅色主题

#### 2.2 (2020/9/6)
- 联网查词

#### 2.1 (2020/9/6)
- 命令整合至右键菜单，增加易用性
- 应用单行译文时不再需要选中双行文本

#### 2.0 (2020/9/5)
- 格式化文本：功能增至8种
- 更新设置格式（与之前版本不兼容，需要重新填写设置）

#### 1.2 (2020/8/30)
- 格式化文本；自动添加空格、括号

#### 1.1 (2020/8/30)
- 提取译文
- 将修改后的译文再应用到双行文本中

#### 1.0 (2020/8/29)
- 项目管理
  - 添加、删除项目
  - 将其他用户添加到自己的项目
  - 更改自己管理的项目中的其他用户的权限
- 用户只能访问有权访问的项目
- 用户需要使用用户名和APIToken才能使用云端同步功能
- 因为数据库更新，服务器停止了对1.0之前版本的支持

#### 0.9 (2020/8/17)
- 术语库（测试版）
  - 添加词条
  - 词条高亮
  - 数据同步
- `Ctrl + Enter` 和 `Ctrl + \` 也能实现翻译行的移动

#### 0.2 (2020/8/16)
- 文本高亮支持更多的格式
  - 自动识别人名
- 对常见格式支持快捷键
  - 如果不是常见格式，可以自定义正则表达式


### 0.1 (2020/8/14)
- 对部分支持的双行文本实现文本高亮
- 快捷键
  - `Alt + Enter`移动到下一个翻译行
  - `Alt + \` 移动到上一个翻译行
