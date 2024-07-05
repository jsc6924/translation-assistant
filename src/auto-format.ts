import * as vscode from 'vscode'
import { contains, findEditorByUri, registerCommand } from './utils'
import { DocumentParser } from './parser';
import * as fs from "fs"; 
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
    registerCommand(context, "Extension.dltxt.core.context.autoDetectFormat", async () => {
        const detector = DocumentParser.getFormatDetector();
        await detector.autoDetectFormat(context);
    })

    registerCommand(context, 'Extension.dltxt.core.context.autoDetectFormatContinue', async function(){
		autoDetectFormatContinue();
	});
}
export interface AutoDetector {
    autoDetectFormat(context: vscode.ExtensionContext): void | Promise<void>;
}
export class NoopAutoDetector implements AutoDetector {
    autoDetectFormat(context: vscode.ExtensionContext): void {
        vscode.window.showInformationMessage(`当前配置下暂不支持自动识别文本格式`);
    }
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
        let foundEmptyLine = false;
        for (let lineNumber = startLine; lineNumber < activeEditor.document.lineCount; lineNumber++) {
            if (activeEditor.document.lineAt(lineNumber).text.trim()) {
                continue;
            }
            startLine = lineNumber;
            foundEmptyLine = true;
            break;
        }
        
        const maxCount = 30;
        let rlines = [], tlines = [];
        for (let lineNumber = startLine; lineNumber < activeEditor.document.lineCount - 1
            && rlines.length < maxCount; lineNumber++) {
            const thisLine = activeEditor.document.lineAt(lineNumber).text.trim();

            if (oReg && oReg.test(thisLine)) {
                continue;
            }

            if (containsJapaneseCharacters(thisLine)) {
                if (rlines.length == tlines.length) {
                    rlines.push(thisLine);
                } else {
                    tlines.push(thisLine);
                }
            }
        }
        if (rlines.length > tlines.length) {
            rlines.pop();
        }
        if (rlines.length < 2 || tlines.length < 2 || rlines.length !== tlines.length) {
            vscode.window.showInformationMessage(`识别失败`);
            return;
        }
        if (!foundEmptyLine) {
            const options = ['原文','译文'];
            const r = await vscode.window.showQuickPick(options, {placeHolder: `这是原文还是译文：${rlines[0]}`});
            if(!r) {
                return;
            }
            if (r == '译文') {
                const temp = rlines;
                rlines = tlines;
                tlines = temp;
            }
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
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

export class TextBlockAutoDetector implements AutoDetector {
    async autoDetectFormat(context: vscode.ExtensionContext) {
        if (!vscode.window.activeTextEditor) {
            return;
        }
        const thisEditor = vscode.window.activeTextEditor;
        if (!thisEditor.selection || thisEditor.selection.isEmpty) {
            vscode.window.showInformationMessage("请选中一个段落后再使用自动识别");
            return;
        }
        const text = thisEditor.document.getText(new vscode.Range(
            new vscode.Position(thisEditor.selection.start.line, 0),
            new vscode.Position(thisEditor.selection.end.line, Number.MAX_SAFE_INTEGER)
        ));
        const lines = text.split("\n").map((l) => `${l.trim()}`);
        const template = `请把原文替换成【#JP#】，译文替换成【#CN#】\r\n其他所有会变化的部分替换成【#ANY#】\r\n如果变化的部分只包括字母或数字也可替换成【#ALPHA#】\r\n替换结束后在右键菜单中选择“自动识别文本格式：继续”\r\n\r\n<<<<<<<<<<不要动这行<<<<<<<<<<\r\n${lines.join('\r\n')}\r\n>>>>>>>>>>也不要动这行>>>>>>>>>>`;
        const filePath: string = vscode.window.activeTextEditor?.document.uri.fsPath as string;
		if (!filePath) return;
        const dirPath = path.dirname(filePath);
		const fileName = path.basename(filePath);
        const tempDirPath = dirPath + '\\.dltxt'
		if (!fs.existsSync(tempDirPath)) {
			fs.mkdirSync(tempDirPath);
		}
        const tempFilePath = tempDirPath + '\\' + fileName + '.format';
        fs.writeFileSync(tempFilePath, template);
        let setting: vscode.Uri = vscode.Uri.file(tempFilePath);
		
		const document = await vscode.workspace.openTextDocument(setting)
		await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside, false);
    }
}

async function autoDetectFormatContinue() {
    if (!vscode.window.activeTextEditor) {
        vscode.window.showErrorMessage('请打开Auto Detector的临时文件');
        return;
    }
    let curFilePath: string = vscode.window.activeTextEditor?.document.uri.fsPath as string;
    let dlFilePath: string;
    let tempFilePath: string;
    const m = curFilePath.match(/(.*)\.dltxt\\(.*)\.format/);
    if (!m) {
        vscode.window.showErrorMessage('当前编辑器中打开的不是Auto Detector的临时文件');
        return;
    }
    dlFilePath = path.join(m[1], m[2]);
    tempFilePath = curFilePath;
    const dlEditor = findEditorByUri(vscode.Uri.file(dlFilePath));
    if (!dlEditor || !dlEditor?.document)
    {
        vscode.window.showErrorMessage('请先打开需要更改的双行文本');
        return;
    }
    await vscode.window.activeTextEditor.document.save();
    
    const lines = fs.readFileSync(tempFilePath, 'utf8').split(/\r?\n/);
    let dlDocument = dlEditor.document;
    const templateLines: string[] = [];
    const startReg = /^<<<<<+.*<<<<<+$/, endReg = /^>>>>>+.*>>>>>+$/;
    let inTemplate = false;
    for(let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!inTemplate && startReg.test(line.trim())) {
            inTemplate = true;
            continue;
        }
        if (inTemplate) {
            if (endReg.test(line.trim())) {
                break;
            }
            templateLines.push(line.trim());
        }
    }

    const replaceMap = new Map<RegExp, string>([
        [/【#ANY#】/g, '(.*)'],
        [/【#ALPHA#】/g, '([0-9a-zA-Z]+)'],
    ]);
    const jreg = /^(?<prefix>.*)【#JP#】(?<suffix>.*)$/;
    const creg = /^(?<prefix>.*)【#CN#】(?<suffix>.*)$/;
    let jPreStr = '';
    let cPreStr = '';
    let jSuffixStr = '[」]?';
    let cSuffixStr = '[」]?';

    let jpCount = 0, cnCount = 0;
    for(let i = 0; i < templateLines.length; i++) {
        templateLines[i] = escapeRegExp(templateLines[i]);
        for (const [k,v] of replaceMap) {
            templateLines[i] = templateLines[i].replace(k, v);
        }
        let m = null;
        if ((m = jreg.exec(templateLines[i])) && m.groups) {
            jPreStr = m.groups.prefix;
            jSuffixStr = `[」]?${m.groups.suffix}`;
            templateLines[i] = '(?<jp>.*)';
            jpCount++;
        }
        else if ((m = creg.exec(templateLines[i])) && m.groups) {
            cPreStr = m.groups.prefix;
            cSuffixStr = `[」]?${m.groups.suffix}`;
            templateLines[i] = '(?<cn>.*)';
            cnCount++;
        }
        
    }
    const template = templateLines.join("(\\r)?\\n") + "((\\r)?\\n)*";
    try{
        if (jpCount !== 1 || cnCount !== 1) {
            throw new Error("每个段落必须有且只有一行原文和一行译文");
        }
        const reg = new RegExp(template);
        const text = dlDocument.getText();
        if (!reg.test(text)) {
            throw new Error("无法匹配到文本");
        }
    } catch(e) {
        vscode.window.showErrorMessage(`识别失败：${e}`);
        return;
    }
    const u = await vscode.window.showInformationMessage(`识别成功！段落格式："${template}"，原文开头："${jPreStr}"，原文结尾："${jSuffixStr}"，译文开头："${cPreStr}"，译文结尾："${cSuffixStr}"，是否应用？`, '是', '否');
    if (u !== '是') {
        return;
    }
    
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    fs.unlinkSync(tempFilePath);
    const config = vscode.workspace.getConfiguration("dltxt");
    await config.update('core.textBlock.pattern', template, false);
    await config.update('core.x.textBlock.originalPrefix', jPreStr, false);
    await config.update('core.x.textBlock.translatedPrefix', cPreStr, false);
    await config.update('core.y.originalTextSuffix', jSuffixStr, false);
    await config.update('core.y.translatedTextSuffix', cSuffixStr, false);
    vscode.commands.executeCommand("Extension.dltxt.internal.updateDecorations");
    vscode.window.showInformationMessage(`已应用设置`);
}