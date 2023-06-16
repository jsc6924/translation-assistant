import * as vscode from 'vscode';
import { VSCodeContext } from './utils';
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
export const StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
StatusBarItem.command = 'Extension.dltxt.toggleMode';
StatusBarItem.tooltip = 'Click to toggle mode'

export function setMode(newMode: Mode) {
    VSCodeContext.set('dltxt.mode', Mode[newMode]);
    StatusBarItem.text = `DLTXT Mode: ${Mode[newMode]}`;
    StatusBarItem.show();
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
    StatusBarItem.text = `DLTXT Mode: ${newMode}`;
    StatusBarItem.show();
}
