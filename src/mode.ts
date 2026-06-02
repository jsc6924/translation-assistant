import * as vscode from 'vscode';
import { countInString, registerCommand, VSCodeContext } from './utils';
import { DocumentParser } from './parser';
export enum TranslateMode {
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
export const TranslateModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
TranslateModeStatusBarItem.command = 'Extension.dltxt.toggleMode';
TranslateModeStatusBarItem.tooltip = 'Click to toggle mode'
export const RestrictEditModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
RestrictEditModeStatusBarItem.command = 'Extension.dltxt.toggleRestrictEditMode';
RestrictEditModeStatusBarItem.tooltip = 'Click to toggle restrict edit mode'

export function setTranslateMode(newMode: TranslateMode) {
    VSCodeContext.set('dltxt.mode', TranslateMode[newMode]);
    TranslateModeStatusBarItem.text = `DLTXT 模式: ${TranslateMode[newMode]}`;
    TranslateModeStatusBarItem.show();
}

export function setTranslateModeStr(newMode: string) {
    VSCodeContext.set('dltxt.mode', newMode);
    if (!VSCodeContext.get('dltxt.modeSwitchedMsgShowed')) {
        if (newMode != 'Normal') {
            vscode.window.showInformationMessage(`当前为${newMode}模式，按Esc退出, 在状态栏可查看/更改当前模式`);
        } else {
            vscode.window.showInformationMessage(`当前为${newMode}模式`);
        }
        VSCodeContext.set('dltxt.modeSwitchedMsgShowed', true);
    }
    TranslateModeStatusBarItem.text = `DLTXT 模式: ${newMode}`;
    TranslateModeStatusBarItem.show();
}

export function setRestrictEditMode(enabled: boolean) {
    VSCodeContext.set('dltxt.strictEditing', enabled);
    RestrictEditModeStatusBarItem.text = `限制编辑模式: ${enabled ? '开启' : '关闭'}`;
    RestrictEditModeStatusBarItem.show();
}


export function ShowRestrictEditingWarning(msg: string) {
    vscode.window.showWarningMessage(msg, '允许编辑').then(selection => {
        if (selection === '允许编辑') {
            setRestrictEditMode(false);
        }
    });
}

function isInStrictEditingMode(): boolean {
    return VSCodeContext.get('dltxt.strictEditing') === true;
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
    setTranslateMode(TranslateMode.Normal);
    setRestrictEditMode(true);

    registerCommand(context, "Extension.dltxt.setMode", (args) => {
        setTranslateModeStr(args.arg);
    });
    registerCommand(context, "Extension.dltxt.toggleMode", () => {
        const m = VSCodeContext.get('dltxt.mode') as string;
        setTranslateModeStr(getNextMode(m));
    });
    registerCommand(context, "Extension.dltxt.toggleRestrictEditMode", () => {
        setRestrictEditMode(!isInStrictEditingMode());
    });

}