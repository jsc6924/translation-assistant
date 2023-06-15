import * as vscode from 'vscode';
import { VSCodeContext } from './utils';
export enum Mode {
	Normal,
	Translate
}


export function setMode(newMode: Mode) {
    VSCodeContext.set('dltxt.mode', Mode[newMode]);
}

export function setModeStr(newMode: string) {
    VSCodeContext.set('dltxt.mode', newMode);
    if (newMode != 'Normal') {
        vscode.window.showInformationMessage(`当前为${newMode}模式，按Esc退出`);
    } else {
        vscode.window.showInformationMessage(`当前为${newMode}模式`);
    }
}