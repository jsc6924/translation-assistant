import * as vscode from 'vscode';
import { registerCommand } from './utils';
import { editorWriteString } from './motion';
import { ContextHolder } from './utils';
import { BasicTreeItem, BasicTreeView } from './treeview';

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
    return ContextHolder.getWorkspaceState(key, clipboardDefaultValues.get(key)) as string;
  }
  static set(context: vscode.ExtensionContext, key: string, value: string | undefined) {
    return ContextHolder.setWorkspaceState(key, value);
  }
}

export function activate(context: vscode.ExtensionContext) {
    let clipboard_view = new ClipBoardTreeView(context);
	vscode.window.registerTreeDataProvider('dltxt-clipboard', clipboard_view);

    registerCommand(context, 'Extension.dltxt.setClipboardString', (args) => {
		const key = args.arg1;
		const reg_num = key[key.length - 1]
		let editor = vscode.window.activeTextEditor;
		if (!editor) return;
		let text = '';
		text = editor.document.getText(editor.selection);
		ClipBoardManager.set(context, key, text ? text : undefined)
    if (text) {
      vscode.window.showInformationMessage(`已复制到${reg_num}号剪贴板：[${text}]`);
    } else {
      vscode.window.showInformationMessage(`已清空${reg_num}号剪贴板`);
    }
    clipboard_view.refresh(context);
	});

  registerCommand(context, "Extension.dltxt.treeview.writeClipboardString", (item: ClipBoardItem) => {
		let editor = vscode.window.activeTextEditor;
		if (!editor) return;
		editorWriteString(item.value);
	});

    registerCommand(context, 'Extension.dltxt.treeview.setClipboardString', (item: ClipBoardItem) => {
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
            ClipBoardManager.set(context, key, text ? text : undefined);
            clipboard_view.refresh(context);
        })
	});
}

class ClipBoardItem extends BasicTreeItem {
  value: string = '';
  index: string;
  contextValue = 'clipboard-item';
  iconPath = new vscode.ThemeIcon('symbol-key');
  constructor(label: string, index: string, value: string) {
      super(label, vscode.TreeItemCollapsibleState.None);
      this.index = index;
      this.value = value;
      this.command = {
          command: 'Extension.dltxt.copyToClipboard', 
          title : 'copy value', 
          arguments: [{text: value}] 
      };
  }
}

class ClipBoardTreeView extends BasicTreeView<ClipBoardItem>
{
  constructor(context: vscode.ExtensionContext) {
    super();
    this.refresh(context);
  }
  getTreeItem(item: ClipBoardItem): vscode.TreeItem {
      return item;
  }

  refresh(context: vscode.ExtensionContext) {
      const prefix = 'clipboard.customString';
      this.roots = []
      for (let i = 1; i <= 6; i++) {
          const k = prefix + String(i);
          const v = ClipBoardManager.get(context, k);
          this.roots.push(new ClipBoardItem(`${i}: ${v}`, String(i), v));
      }
      this.dataChanged();
  }
}