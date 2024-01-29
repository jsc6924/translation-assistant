import * as vscode from 'vscode'
import { contains, registerCommand } from './utils'
import { DocumentParser } from './parser';

export function activate(context: vscode.ExtensionContext) {
    registerCommand(context, "Extension.dltxt.core.context.autoDetectFormat", async () => {
        const detector = DocumentParser.getFormatDetector();
        await detector.autoDetectFormat(context);
    })
}
export interface AutoDetector {
    autoDetectFormat(context: vscode.ExtensionContext): void;
}
export class StandardParserAutoDetector implements AutoDetector {
    async autoDetectFormat(context: vscode.ExtensionContext) {
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
        while (true) {
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

        let oRegStr = '';
        let oReg = null;
        if (otherLines.length > 0) {
            oRegStr = generateRegex(otherLines);
            if (!oRegStr) {
                oRegStr = forceGeneratePrefix(otherLines);
            }
            oReg = new RegExp(`^(${oRegStr})(.*)`);
        }

        //find the next empty line as the startLine
        for (let lineNumber = startLine; lineNumber < activeEditor.document.lineCount; lineNumber++) {
            if (activeEditor.document.lineAt(lineNumber).text.trim()) {
                continue;
            }
            startLine = lineNumber;
            break;
        }
        const maxCount = 30;
        const rlines = [], tlines = [];
        for (let lineNumber = startLine; lineNumber < activeEditor.document.lineCount - 1
            && rlines.length < maxCount;) {
            const thisLine = activeEditor.document.lineAt(lineNumber).text.trim();
            const nextLine = activeEditor.document.lineAt(lineNumber + 1).text.trim();

            if (oReg && oReg.test(thisLine)) {
                lineNumber++;
                continue;
            }

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

        rRegStr = regexSubstract(rRegStr, [{ otherReg: tRegStr, otherLines: tlines }, { otherReg: oRegStr, otherLines: otherLines }]);
        tRegStr = regexSubstract(tRegStr, [{ otherReg: rRegStr, otherLines: rlines }, { otherReg: oRegStr, otherLines: otherLines }]);
        if (matchAnyPrefix(rRegStr, tlines) || matchAnyPrefix(tRegStr, rlines)) {
            vscode.window.showInformationMessage(`识别失败`);
            return;
        }

        const u = await vscode.window.showInformationMessage(`识别成功！原文标签："${rRegStr}"，译文标签："${tRegStr}"，其他标签："${oRegStr}"，是否应用？`, '是', '否');
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
}

function regexSubstract(reg: string,
    notWanted: {
        otherReg: string, otherLines: string[]
    }[]) {
    const substractSet: string[] = [];
    const prefix = reg ? '' : '^';
    const suffix = reg ? '' : `(?=.)`;
    for (const { otherReg, otherLines } of notWanted) {
        if (otherReg && matchAnyPrefix(reg, otherLines)) {
            substractSet.push(otherReg);
        }
    }
    if (substractSet.length) {
        const toRemove = substractSet.map(s => `(${s})`).join('|');
        return `${prefix}(?!(${toRemove}))${reg}${suffix}`
    }
    return `${prefix}${reg}${suffix}`;
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
    for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i][0] !== lines[i + 1][0]) {
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
    for (let i = 0; i < lines.length; i++) {
        if (!isAlphaNum(lines[i][0])) {
            return false;
        }
    }
    return true;
}

function escapeRegExp(text: string) {
    return text.replace(/[-[\]{}()*+?.,\\^$|\s]/g, '\\$&');
}

const paraMap = new Map<string, string>([
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
    ["<", ">"],
    ["《", "》"],
    ["【", "】"],
    ["（", "）"],
]);
const paraReverseMap = new Map<string, string>();
for (const [k, v] of paraMap) {
    paraReverseMap.set(v, k);
}

function generateRegex(lines: string[]): string {
    let regStr = '';
    const openingPar = [];
    while (true) {
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
            if (paraMap.has(candidate)) {
                openingPar.push(candidate);
            } else if (paraReverseMap.has(candidate)) {
                const left = paraReverseMap.get(candidate) as string;
                const i = openingPar.lastIndexOf(left);
                if (i !== -1) {
                    openingPar.splice(i, 1);
                }
            }
            regStr += escapeRegExp(candidate);
            continue;
        }
        if (openingPar.length) {
            const left = openingPar.pop();
            const right = paraMap.get(left as string) as string;
            if (matchAllPrefix(`${regStr}.*?${right}`, lines)) {
                regStr += '.*?' + escapeRegExp(right);
                continue;
            }
        }
        break;
    }
    return regStr;
}


function matchAnyPrefix(regStr: string, lines: string[]) {
    const reg = new RegExp(`^(${regStr})(.*)`);
    for (const line of lines) {
        if (reg.test(line)) {
            return true;
        }
    }
    return false;
}

function matchAllPrefix(regStr: string, lines: string[]) {
    const reg = new RegExp(`^(${regStr})(.*)`);
    for (const line of lines) {
        if (!reg.test(line)) {
            return false;
        }
    }
    return true;
}

function forceGeneratePrefix(lines: string[]) {
    const prefixs = new Set<string>();
    for (const line of lines) {
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