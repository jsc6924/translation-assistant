import * as vscode from 'vscode';
import { dltxt } from './treeview';
import { registerCommand } from './utils';
import { editorWriteString } from './motion';

const ClipboardStringPrefix = 'clipboard.customString';

let clipboardDefaultValues = new Map([
    ['clipboard.customString1', '～'],
    ['clipboard.customString2', '♪'],
    ['clipboard.customString3', '♥'],
    ['clipboard.customString4', 'ー'],
    ['clipboard.customString5', '『'],
    ['clipboard.customString6', '』'],
])

export class ClipBoardManager {
  static get(context: vscode.ExtensionContext, key: string): string {
    return context.workspaceState.get(key, clipboardDefaultValues.get(key)) as string;
  }
  static set(context: vscode.ExtensionContext, key: string, value: string | undefined): Thenable<void> {
    return context.workspaceState.update(key, value);
  }
}

export function activate(context: vscode.ExtensionContext) {
    let clipboard_view = new dltxt.ClipBoardTreeView(context);
	vscode.window.registerTreeDataProvider('dltxt-clipboard', clipboard_view);

    registerCommand(context, 'Extension.dltxt.setClipboardString', (args) => {
		const key = args.arg1;
		const reg_num = key[key.length - 1]
		let editor = vscode.window.activeTextEditor;
		if (!editor) return;
		let text = '';
		text = editor.document.getText(editor.selection);
		ClipBoardManager.set(context, key, text ? text : undefined).then(() => {
			if (text) {
				vscode.window.showInformationMessage(`已复制到${reg_num}号剪贴板：[${text}]`);
			} else {
				vscode.window.showInformationMessage(`已清空${reg_num}号剪贴板`);
			}
			clipboard_view.refresh(context);
		})
	});

  registerCommand(context, "Extension.dltxt.treeview.writeClipboardString", (item: dltxt.ValueItem) => {
		let editor = vscode.window.activeTextEditor;
		if (!editor) return;
		editorWriteString(item.value);
	});

    registerCommand(context, 'Extension.dltxt.treeview.setClipboardString', (item: dltxt.ValueItem) => {
		const reg_num = item.index;
		const key = ClipboardStringPrefix + reg_num;
		let editor = vscode.window.activeTextEditor;
		if (!editor) return;
		vscode.window.showInputBox({
            prompt: '输入内容',
            value: item.value
        }).then((text) => {
            if (text === undefined) {
                return;
            }
            ClipBoardManager.set(context, key, text ? text : undefined).then(() => {
                clipboard_view.refresh(context);
            })
        })
	});
}