import * as vscode from 'vscode';
import { VSCodeContext } from './utils';
export enum Mode {
	Normal,
	Translate
}

export const StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

export function setMode(newMode: Mode) {
    VSCodeContext.set('dltxt.mode', Mode[newMode]);
    StatusBarItem.text = `DLTXT Mode: ${Mode[newMode]}`;
    StatusBarItem.show();
}

export function setModeStr(newMode: string) {
    VSCodeContext.set('dltxt.mode', newMode);
    if (!VSCodeContext.get('dltxt.modeSwitchedMsgShowed')) {
        if (newMode != 'Normal') {
            vscode.window.showInformationMessage(`当前为${newMode}模式，按Esc退出, 状态栏左下角可查看当前模式`);
        } else {
            vscode.window.showInformationMessage(`当前为${newMode}模式`);
        }
        VSCodeContext.set('dltxt.modeSwitchedMsgShowed', true);
    }
    StatusBarItem.text = `DLTXT Mode: ${newMode}`;
    StatusBarItem.show();
}