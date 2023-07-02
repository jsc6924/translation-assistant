import * as vscode from 'vscode'
import { contains, registerCommand } from './utils'

export function activate(context: vscode.ExtensionContext) {
    registerCommand(context, "Extension.dltxt.core.context.autoDetectFormat", async () => {
        await autoDetectFormat(context);
    })
}

async function autoDetectFormat(context: vscode.ExtensionContext) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showInformationMessage(`请打开一个文本再执行此命令`);
        return;
    }
    let startLine = 0;
    if (activeEditor.selection) {
        startLine = activeEditor.selection.active.line;
    }

    const otherLines = [];
    while(true) {
        const r = await vscode.window.showInputBox({
            "placeHolder": "例：@1",
            "prompt": `输入几个既不是原文也不是译文的例子，输入空字符串表示结束`,
            "ignoreFocusOut": true
        });
        if (r) {
            otherLines.push(r);
            continue;
        }
        break;
    }

    //find the next empty line as the startLine
    for (let lineNumber = startLine; lineNumber < activeEditor.document.lineCount; lineNumber++) {
        if (activeEditor.document.lineAt(lineNumber).text.trim()) {
            continue;
        }
        startLine = lineNumber;
        break;
    }
    const maxCount = 10;
    const rlines = [], tlines = [];
    for (let lineNumber = startLine; lineNumber < activeEditor.document.lineCount - 1 
        && rlines.length < maxCount;) {
            const thisLine = activeEditor.document.lineAt(lineNumber).text.trim();
            const nextLine = activeEditor.document.lineAt(lineNumber + 1).text.trim();
            if (containsJapaneseCharacters(thisLine) && nextLine) {
                rlines.push(thisLine);
                tlines.push(nextLine);
                lineNumber += 2;
            } else {
                lineNumber++;
            }
    }
    if (rlines.length < 2 || tlines.length < 2) {
        vscode.window.showInformationMessage(`识别失败`);
        return;
    }
    let rRegStr = generateRegex(rlines);
    let tRegStr = generateRegex(tlines);
    let oRegStr = '';
    if (otherLines.length > 0) {
        oRegStr = generateRegex(otherLines);
        if (!oRegStr) {
            oRegStr = forceGeneratePrefix(otherLines);
        }
    }
    const rRegStrOriginal = rRegStr;
    const tRegStrOriginal = tRegStr;

    if (matchAnyPrefix(rRegStr, tlines)) {
        const suffix = rRegStrOriginal ? '' : `(?=.)`;
        if (oRegStr) {
            rRegStr = `^(?!((${tRegStrOriginal})|(${oRegStr})))${rRegStrOriginal}${suffix}`;
        } else {
            rRegStr = `^(?!(${tRegStrOriginal}))${rRegStrOriginal}${suffix}`;
        }
    }
    if (matchAnyPrefix(tRegStr, rlines)) {
        const suffix = tRegStrOriginal ? '' : `(?=.)`;
        if (oRegStr) {
            tRegStr = `^(?!((${rRegStrOriginal})|(${oRegStr})))${tRegStrOriginal}${suffix}`;
        } else {
            tRegStr = `^(?!(${rRegStrOriginal}))${tRegStrOriginal}${suffix}`;
        }
    }
    if (matchAnyPrefix(rRegStr, tlines) || matchAnyPrefix(tRegStr, rlines)) {
        vscode.window.showInformationMessage(`识别失败`);
        return;
    }
    
    const u = await vscode.window.showInformationMessage(`识别成功！\n原文标签："${rRegStr}"\n译文标签："${tRegStr}"\n其他标签："${oRegStr}"\n是否应用？`, '是', '否');
    if (u !== '是') {
        return;
    }
    const config = vscode.workspace.getConfiguration("dltxt");
    await config.update('core.originalTextPrefixRegex', rRegStr, false);
    await config.update('core.translatedTextPrefixRegex', tRegStr, false);
    await config.update('core.otherPrefixRegex', oRegStr, false);
    vscode.commands.executeCommand("Extension.dltxt.internal.updateDecorations");
    vscode.window.showInformationMessage(`已应用设置`);
}

function containsJapaneseCharacters(str: string): boolean {
    // Regular expression to match Japanese characters or kanji
    const regex = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]/gu;
    return regex.test(str);
  }


function commonPrefix(lines: string[]): string {
    if (!lines) return '';
    let maxLen = Math.min(...lines.map(line => line.length));
    if (maxLen == 0) {
        return '';
    }
    for(let i = 0; i < lines.length - 1; i++) {
        if (lines[i][0] !== lines[i+1][0]) {
            return '';
        }
    }
    return lines[0][0];
}

function isAlphaNum(char: string): boolean {
    return /^[a-zA-Z0-9]$/.test(char);
}

function hasAlphaNumPrefix(lines: string[]): boolean {
    if (!lines) return false;
    let maxLen = Math.min(...lines.map(line => line.length));
    if (maxLen == 0) {
        return false;
    }
    for(let i = 0; i < lines.length; i++) {
        if (!isAlphaNum(lines[i][0])) {
            return false;
        }
    }
    return true;
}

function escapeRegExp(text: string) {
    return text.replace(/[-[\]{}()*+?.,\\^$|\s]/g, '\\$&');
}

function generateRegex(lines: string[]): string {
    let regStr = '';
    while(true) {
        const reg = new RegExp(`^(${regStr})(.*)`);
        const reminders = [];
        for (const line of lines) {
            const m = reg.exec(line);
            if (!m) {
                throw new Error(`generateRegex error`);
            }
            const r = m[2];
            reminders.push(r);
        }
        if (hasAlphaNumPrefix(reminders)) {
            regStr += '[A-Za-z0-9]+';
            continue;
        }
        let candidate = commonPrefix(reminders);
        if (candidate) {
            regStr += escapeRegExp(candidate);
            continue;
        }
        break;
    }
    return regStr;
}

function matchAnyPrefix(regStr: string, lines: string[]) {
    const reg = new RegExp(`^(${regStr})(.*)`);
    for(const line of lines) {
        if (reg.test(line)) {
            return true;
        }
    }
    return false;
}

function forceGeneratePrefix(lines: string[]) {
    const prefixs = new Set<string>();
    for(const line of lines) {
        const c = line[0];
        if (isAlphaNum(c)) {
            prefixs.add('[A-Za-z0-9]+');
        } else {
            prefixs.add(c);
        }
    }
    const prefixList: string[] = [];
    prefixs.forEach(p => prefixList.push(escapeRegExp(p)));
    const reg = prefixList.join('|');
    return reg;
}