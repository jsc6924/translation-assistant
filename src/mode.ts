import * as vscode from 'vscode';
import { countInString, VSCodeContext } from './utils';
import { DocumentParser } from './parser';
export enum Mode {
	Normal,
	Translate
}
const nextModeMap = new Map([
    ['Normal', 'Translate'],
    ['Translate', 'Normal']
]);

export function getNextMode(mode: string): string {
    if (nextModeMap.has(mode)) {
        return nextModeMap.get(mode) as string;
    }
    return 'Normal';
}
export const ModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
ModeStatusBarItem.command = 'Extension.dltxt.toggleMode';
ModeStatusBarItem.tooltip = 'Click to toggle mode'

export function setMode(newMode: Mode) {
    VSCodeContext.set('dltxt.mode', Mode[newMode]);
    ModeStatusBarItem.text = `DLTXT Mode: ${Mode[newMode]}`;
    ModeStatusBarItem.show();
}

export function setModeStr(newMode: string) {
    VSCodeContext.set('dltxt.mode', newMode);
    if (!VSCodeContext.get('dltxt.modeSwitchedMsgShowed')) {
        if (newMode != 'Normal') {
            vscode.window.showInformationMessage(`当前为${newMode}模式，按Esc退出, 在状态栏可查看/更改当前模式`);
        } else {
            vscode.window.showInformationMessage(`当前为${newMode}模式`);
        }
        VSCodeContext.set('dltxt.modeSwitchedMsgShowed', true);
    }
    ModeStatusBarItem.text = `DLTXT Mode: ${newMode}`;
    ModeStatusBarItem.show();
}

let tempDisableStrictEditing = false;

export function refreshStrictEditingContext() {
    const strictEditing = vscode.workspace.getConfiguration('dltxt.core').get<boolean>('strictEditing') === true;
    void VSCodeContext.set('dltxt.strictEditingEffective', strictEditing && !tempDisableStrictEditing);
}

export function ShowRestrictEditingWarning(msg: string) {
    vscode.window.showWarningMessage(msg, '临时关闭').then(selection => {
        if (selection === '临时关闭') {
            tempDisableStrictEditing = true;
            refreshStrictEditingContext();
        }
    });
}

function isInStrictEditingMode(): boolean {
    return vscode.workspace.getConfiguration('dltxt.core').get<boolean>('strictEditing') === true && !tempDisableStrictEditing;
}

export function processOnDidChangeTextDocument(event: vscode.TextDocumentChangeEvent): boolean {
    const noStrict = (event.reason === vscode.TextDocumentChangeReason.Undo || 
                        event.reason === vscode.TextDocumentChangeReason.Redo);
    if (!noStrict && isInStrictEditingMode()) {
        for (const change of event.contentChanges) {
            const startLine = change.range.start.line;
            const endLine = change.range.end.line;
            const originalLineCount = endLine - startLine + 1;
            const newLineCount = countInString(change.text, '\n') + 1;
            if (originalLineCount !== newLineCount) {
                vscode.commands.executeCommand('undo');
                ShowRestrictEditingWarning(`不可删除或插入行。您可以在设置中查找dltxt.core.strictEditing关闭此功能。${change.range.start.line} ${change.range.end.line}`);

                return true;
            }
            if (newLineCount <= 2) {
                for (let line = startLine; line <= endLine; line++) {
                    const lineText = event.document.lineAt(line).text;
                    if (DocumentParser.isUneditable(lineText)) {
                        vscode.commands.executeCommand('undo');
                        ShowRestrictEditingWarning(`原文不可编辑。您可以在设置中查找dltxt.core.strictEditing关闭此功能。${change.range.start.line}`);
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

export function activate(context: vscode.ExtensionContext) {
    refreshStrictEditingContext();

    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('dltxt.core.strictEditing')) {
            refreshStrictEditingContext();
        }
    }, null, context.subscriptions);
}