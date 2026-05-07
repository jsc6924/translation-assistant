import * as vscode from 'vscode';
import { BasicTreeItem, TreeItem, BasicTreeView, CommandItem, ConfigRootItem, ConfigEntryItem } from './treeview';
import { configureFormat } from './formatter';
import { batchCheckCommand, batchInsertNewline, batchRemoveNewline, batchReplace, batchReportCommand, batchSpecialTranslate, batchWordCountCommand } from './batch';
import { clearAllWarnings } from './error-check';
import { ContextHolder } from './utils';
import { checkSimilarText } from './crossref';
import { getLanguageClient, RequestEcho } from './lspclient';
import { downloadDefaultServer, stopDictServer } from './dictserver';
import { channel } from './dlbuild';

export namespace cc_view {
    class CCDirectory extends TreeItem<CCTreeView> {
        children: BasicTreeItem[] = [];
        iconPath = new vscode.ThemeIcon('debug-collapse-all');
        constructor(treeview: CCTreeView, label: string, state: vscode.TreeItemCollapsibleState, iconPath?: string) {
            super(treeview, label, state);
            if (iconPath) {
                this.iconPath = new vscode.ThemeIcon(iconPath);
            }
        }

        getChildren(): BasicTreeItem[] {
            return this.children;
        }
    };



    export class CCTreeView extends BasicTreeView<TreeItem<CCTreeView>> {
        constructor(context: vscode.ExtensionContext) {
            super();
            const configCommands = new CCDirectory(this, "设置向导", vscode.TreeItemCollapsibleState.Collapsed, 'settings-gear');
            this.roots.push(configCommands);
            configCommands.children.push(new CommandItem("自动识别文本格式", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.core.context.autoDetectFormat');
            }, 'settings-gear'));
            configCommands.children.push(new CommandItem("设置文本格式规范", async () => {
                await configureFormat();
            }, 'settings-gear'));
            configCommands.children.push(new CommandItem("切换换行符显示", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.switchNewlineTokenDisplay');
            }, 'settings-gear'));
            configCommands.children.push(new CommandItem("切换编辑限制模式", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.switchStrictEditing');
            }, 'settings-gear'));


            const textCommands = new CCDirectory(this, "文本编辑", vscode.TreeItemCollapsibleState.Collapsed);
            this.roots.push(textCommands);
            textCommands.children.push(new CommandItem("复制原文到未翻译的译文行", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.copy_original');
            }));
            textCommands.children.push(new CommandItem("翻译特殊拟声词", async () => {
                await batchSpecialTranslate();
            }));
            textCommands.children.push(new CommandItem("删除换行符", async () => {
                await batchRemoveNewline();
            }));
            textCommands.children.push(new CommandItem("自动插入换行符", async () => {
                await batchInsertNewline();
            }));
            textCommands.children.push(new CommandItem("提取译文", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.extract_single_line');
            }));
            textCommands.children.push(new CommandItem("格式化文本", async () => {
                await vscode.commands.executeCommand('editor.action.formatDocument');
            }));

            textCommands.children.push(new CommandItem("批量替换译文", async () => {
                await vscode.window.showInputBox({ prompt: '请输入要替换的文本（不支持正则表达式）' }).then(async (rawText) => {
                    if (!rawText) {
                        return;
                    }
                    await batchReplace(rawText);
                });
            }));

            const checkingNode = new CCDirectory(this, "文本检查", vscode.TreeItemCollapsibleState.Collapsed);
            this.roots.push(checkingNode);
            checkingNode.children.push(new CommandItem("批量检查译文", async () => {
                await batchCheckCommand();
            }));
            checkingNode.children.push(new CommandItem("批量检查译文并生成报告", async () => {
                await batchReportCommand();
            }));
            checkingNode.children.push(new CommandItem("清除所有警告", async () => {
                clearAllWarnings();
            }));
            checkingNode.children.push(new CommandItem("检查当前文本中的错别字", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.spellCheck');
            }));
            checkingNode.children.push(new CommandItem("清除错别字检查结果", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.spellCheckClear');
            }));
            checkingNode.children.push(new CommandItem("清除常用汉字警告白名单", async () => {
                ContextHolder.setWorkspaceState('escapedCharacters', undefined);
            }));
            checkingNode.children.push(new CommandItem("检查相似的文本", async () => {
                await checkSimilarText(context);
            }));
            checkingNode.children.push(new CommandItem("识别文本编码", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.detectEncoding');
            }));
            checkingNode.children.push(new CommandItem("字数统计", async () => {
                await batchWordCountCommand();
            }));



            const batchNode = new CCDirectory(this, "进阶批量操作", vscode.TreeItemCollapsibleState.Collapsed);
            this.roots.push(batchNode);
            batchNode.children.push(new CommandItem("批量转换文件编码格式", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.convertToEncoding');
            }));
            batchNode.children.push(new CommandItem("将脚本提取为双行文本", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.dlbuild.extract');
            }));
            batchNode.children.push(new CommandItem("用双行文本的翻译替换脚本中的原文", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.dlbuild.pack');
            }));
            batchNode.children.push(new CommandItem("字数统计", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.dltransform.wordcount');
            }));
            batchNode.children.push(new CommandItem("将文本连接", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.dltransform.concat');
            }));
            batchNode.children.push(new CommandItem("将文本合并", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.dltransform.merge');
            }));
            
            batchNode.children.push(new CommandItem("执行自定义批量文本操作", async () => {
                await vscode.commands.executeCommand('Extension.dltxt.dltransform.transform');
            }));
            batchNode.children.push(new CommandItem("test dltxt/echo", async () => {
                // get user input
                const input = await vscode.window.showInputBox({ prompt: '输入要发送到 dltxt/echo 的文本' });
                if (!input) {
                    return;
                }
                // send request to language server
                const client = getLanguageClient();
                if (!client) {
                    vscode.window.showErrorMessage('语言服务器未启动');
                    return;
                }
                try {
                    const response = await client.sendRequest(RequestEcho, { message: input });
                    vscode.window.showInformationMessage(`dltxt/echo response: ${response.result}`);
                } catch (err) {
                    vscode.window.showErrorMessage(`dltxt/echo 请求失败: ${err}`);
                }
            }));
                



            const dictServerNode = new CCDirectory(this, "辞典服务器", vscode.TreeItemCollapsibleState.Collapsed);
            this.roots.push(dictServerNode);
            dictServerNode.children.push(new CommandItem("关闭辞典服务器", () => {
                if (!stopDictServer()) {
                    vscode.window.showInformationMessage("当前没有辞典服务器在运行，或者辞典服务器不是由vscode启动的");
                } else {
                    vscode.window.showInformationMessage("已关闭辞典服务器");
                }
            }));

            dictServerNode.children.push(new CommandItem("更新辞典服务器", async () => {
                stopDictServer();
                channel.show();
                await downloadDefaultServer(ContextHolder.get());
            }));

            const baiduAPINode = new ConfigRootItem(this, "百度智能云API", vscode.TreeItemCollapsibleState.Collapsed);
            baiduAPINode.children.push(new ConfigEntryItem(this, baiduAPINode, "AccessKey", "dltxt.config.baidu.accesskey", true, false));
            baiduAPINode.children.push(new ConfigEntryItem(this, baiduAPINode, "SecretKey", "dltxt.config.baidu.secretkey", true, false));
            this.roots.push(baiduAPINode);


            this.dataChanged();
        }

    }
}