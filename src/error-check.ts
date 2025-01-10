import * as vscode from 'vscode';
import { VSCodeContext, findAllAndProcess, DltxtDiagCollection, DltxtDiagCollectionMissionLine, DltxtDiagCollectionSpellcheck, ContextHolder } from './utils';
import { DocumentParser, MatchedGroups } from './parser';
import { shouldSkipChecking } from './utils';
import { getTextDelimiter } from './motion';
import * as iconv from "iconv-lite";

// not used yet, can be used to diagnostic 
export enum ErrorCode {
    Untranslated =  1,
    UnusualCharacter = 2,
    EndWithPeriod = 3,
    WrongEcllipsis = 4,
    WrongWave = 5,
    WrongHorizontalLine = 6,
    FoundH2fPunc = 7,
    WrongPuncComb = 8,
    FoundKana = 9,
    ExclamationQuestion = 10,
}

export function activate(context: vscode.ExtensionContext) {
    const codeActionProvider = new MyCodeActionProvider();
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider('dltxt', codeActionProvider));
    context.subscriptions.push(vscode.commands.registerCommand('dltxt.escapeCharacter', (char: string) => {
        const escapedList = ContextHolder.getWorkspaceState("escapedCharacters", []) as string[];
        escapedList.push(char);
        ContextHolder.setWorkspaceState("escapedCharacters", escapedList);
        updateErrorDecorations();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('dltxt.disableWarning', async (setting: string) => {
        const config = vscode.workspace.getConfiguration("dltxt");
        await config.update(setting, false, vscode.ConfigurationTarget.Workspace);
        updateErrorDecorations();
    }));
}

export class MyCodeActionProvider implements vscode.CodeActionProvider {
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        const codeActions: vscode.CodeAction[] = [];

        context.diagnostics.forEach(diagnostic => {
            switch (diagnostic.code) {
                case ErrorCode.UnusualCharacter: {
                    const fix = new vscode.CodeAction('不再显示这个汉字的警告', vscode.CodeActionKind.QuickFix);
                    //get text of the range
                    const text = document.getText(diagnostic.range);
                    fix.command = {
                        command: 'dltxt.escapeCharacter',
                        title: '把这个汉字加入白名单',
                        arguments: [text]
                    };
                    fix.diagnostics = [diagnostic];
                    fix.isPreferred = true;
                    codeActions.push(fix);
                }
                break;

                case ErrorCode.EndWithPeriod: {
                    const fix = new vscode.CodeAction('不再显示这个警告', vscode.CodeActionKind.QuickFix);
                    fix.command = {
                        command: 'dltxt.disableWarning',
                        title: '关闭警告',
                        arguments: ["formatter.c.omitPeriod"]
                    };
                    fix.diagnostics = [diagnostic];
                    fix.isPreferred = true;
                    codeActions.push(fix);
                }
                break;

                case ErrorCode.WrongEcllipsis: {
                    const fix = new vscode.CodeAction('不再显示这个警告', vscode.CodeActionKind.QuickFix);
                    fix.command = {
                        command: 'dltxt.disableWarning',
                        title: '关闭警告',
                        arguments: ["formatter.a.ellipsis.enable"]
                    };
                    fix.diagnostics = [diagnostic];
                    fix.isPreferred = true;
                    codeActions.push(fix);
                }
                break;

                case ErrorCode.WrongWave: {
                    const fix = new vscode.CodeAction('不再显示这个警告', vscode.CodeActionKind.QuickFix);
                    fix.command = {
                        command: 'dltxt.disableWarning',
                        title: '关闭警告',
                        arguments: ["formatter.a.wave.enable"]
                    };
                    fix.diagnostics = [diagnostic];
                    fix.isPreferred = true;
                    codeActions.push(fix);
                }
                break;

                case ErrorCode.WrongHorizontalLine: {
                    const fix = new vscode.CodeAction('不再显示这个警告', vscode.CodeActionKind.QuickFix);
                    fix.command = {
                        command: 'dltxt.disableWarning',
                        title: '关闭警告',
                        arguments: ["formatter.a.horizontalLine.enable"]
                    };
                    fix.diagnostics = [diagnostic];
                    fix.isPreferred = true;
                    codeActions.push(fix);
                }
                break;

                case ErrorCode.FoundH2fPunc: {
                    const fix = new vscode.CodeAction('不再显示这个警告', vscode.CodeActionKind.QuickFix);
                    fix.command = {
                        command: 'dltxt.disableWarning',
                        title: '关闭警告',
                        arguments: ["formatter.b.h2fPunc"]
                    };
                    fix.diagnostics = [diagnostic];
                    fix.isPreferred = true;
                    codeActions.push(fix);
                }
                break;

                case ErrorCode.WrongPuncComb: {
                    const fix = new vscode.CodeAction('不再显示这个警告', vscode.CodeActionKind.QuickFix);
                    fix.command = {
                        command: 'dltxt.disableWarning',
                        title: '关闭警告',
                        arguments: ["appearance.warning.checkPuncCombination"]
                    };
                    fix.diagnostics = [diagnostic];
                    fix.isPreferred = true;
                    codeActions.push(fix);
                }

                case ErrorCode.ExclamationQuestion: {
                    const fix = new vscode.CodeAction('不再显示这个警告', vscode.CodeActionKind.QuickFix);
                    fix.command = {
                        command: 'dltxt.disableWarning',
                        title: '关闭警告',
                        arguments: ["formatter.a.fixExcliamationQuestion"]
                    };
                    fix.diagnostics = [diagnostic];
                    fix.isPreferred = true;
                    codeActions.push(fix);
                }
                break;

            }
        });

        return codeActions;
    }
}

export function updateErrorDecorations() {
    
    const config = vscode.workspace.getConfiguration("dltxt");
    let activeEditor = vscode.window.activeTextEditor;
    
    if (!activeEditor) {
        return;
    }
    const fileName = activeEditor.document.fileName;
    if(!fileName.toLocaleLowerCase().endsWith('.txt')) {
        return;
    }
    DltxtDiagCollection.set(activeEditor.document.uri, undefined);
    const missingLineDiags = DltxtDiagCollectionMissionLine.get(activeEditor.document.uri) ?? [];
    DltxtDiagCollectionMissionLine.set(activeEditor.document.uri, undefined);
    if (!config.get<boolean>('appearance.showError.all')) {
        return;
    }
    const [showError, diagnostics] = DocumentParser.errorCheck(activeEditor.document);

    if (showError) {
        try {
            const [warningDiagnostics, untranslatedLines] = warningCheck(activeEditor.document);
            config.get<boolean>('appearance.warning.all') && diagnostics.push(...warningDiagnostics);
            DltxtDiagCollectionMissionLine.set(activeEditor.document.uri, filterUntranslatedLines(missingLineDiags, untranslatedLines));
        } catch (e) {
            diagnostics.push(createErrorDiagnostic(`${e}`, 0, 0));
        }
        DltxtDiagCollection.set(activeEditor.document.uri, diagnostics);
    } else {
        DltxtDiagCollection.set(activeEditor.document.uri, [
            createDiagnostic(vscode.DiagnosticSeverity.Information, `发现太多错误，没有全部显示。可能没有配置正确，或者这个文本不是双行文本。第一个错误：${diagnostics[0]?.message} Line: ${diagnostics[0]?.range?.start?.line}`, 0, 0, 1)
        ]);
    }
}

// two input arrays must be sorted by line number
export function filterUntranslatedLines(missingLineDiags: readonly vscode.Diagnostic[], untranslatedLines: number[]): vscode.Diagnostic[] {
    const res = [] as vscode.Diagnostic[];
    let i = 0, j = 0;
    while (i < missingLineDiags.length && j < untranslatedLines.length) {
        if (missingLineDiags[i].range.start.line < untranslatedLines[j]) {
            i++;
        } else if (missingLineDiags[i].range.start.line > untranslatedLines[j]) {
            j++;
        } else {
            res.push(missingLineDiags[i]);
            i++;
            j++;
        }
    }
    return res;
}



export function warningCheck(document: vscode.TextDocument): [vscode.Diagnostic[], number[]] {
    const res = [] as vscode.Diagnostic[];
    let untranslatedLines = [] as number[];
    const config = vscode.workspace.getConfiguration("dltxt");
    const delims = getTextDelimiter();
    const nameRegex = /na?me/i;
    const kanaRegex = /[ぁ-んァ-ン]/;
    const skipChecking = (cgrps: MatchedGroups) => {
        if (nameRegex.test(cgrps.prefix) || !kanaRegex.test(cgrps.text) || shouldSkipChecking(cgrps.white + cgrps.text + cgrps.suffix, delims)) {
            return true;
        }
        return false;
    }

    const escapedList = ContextHolder.getWorkspaceState("escapedCharacters", []) as string[];
    const escapedSet = new Set(escapedList);

    const checkUnusualCharacter = config.get<boolean>('appearance.warning.checkUnusualCharacters') as boolean;

    const checkEllipsis = config.get<boolean>('formatter.a.ellipsis.enable') as boolean;
    const checkOmitPeriod = config.get<boolean>('formatter.c.omitPeriod') as boolean;

    const waveTarget = config.get("formatter.a.wave.specify") as string;
    const waveRegStr = `[~∼〜～]`.replace(new RegExp(waveTarget, 'g'), '');
    const checkWave = config.get<boolean>('formatter.a.wave.enable') as boolean && waveRegStr.length > 0;

    const checkHorizontalLine = config.get<boolean>('formatter.a.horizontalLine.enable') as boolean;

    const checkH2fPunc = config.get<boolean>('formatter.b.h2fPunc') as boolean;
    const checkPuncComb = config.get<boolean>('appearance.warning.checkPuncCombination') as boolean;
    const checkExclamationQuestion = config.get<boolean>('formatter.a.fixExcliamationQuestion') as boolean;

    DocumentParser.processPairedLines(document, (jgrps, cgrps, j_index, c_index) => {
        if (jgrps.text === cgrps.text) {
            if (!skipChecking(cgrps)) {
                untranslatedLines.push(c_index);
            }
            return;
        }
        const pre = cgrps.prefix.length + cgrps.white.length;

        checkEllipsis && findAllAndProcess( /(\.{2,})|(。{2,})/g, cgrps.text, (m) => {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '不规范的省略号', c_index, pre + m.index, m[0].length, ErrorCode.WrongEcllipsis));
            return false;
        });

        if (checkWave) {
            findAllAndProcess(new RegExp(waveRegStr, 'g'), cgrps.text, (m) => {
                res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '不规范的波浪号', c_index, pre + m.index, m[0].length, ErrorCode.WrongWave));
                return false;
            });
        }
        
        checkHorizontalLine && findAllAndProcess(/[―ー－]+/g, cgrps.text, (m) => {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '不规范的破折号', c_index, pre + m.index, m[0].length, ErrorCode.WrongHorizontalLine));
            return false;
        });

        checkOmitPeriod && findAllAndProcess(/。[」』]/g, cgrps.text + cgrps.suffix, (m) => {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '引号中的句尾应省略句号', c_index, pre + m.index, m[0].length, ErrorCode.EndWithPeriod));
            return false;
        });

        checkH2fPunc && findAllAndProcess(/[,.?!]+/g, cgrps.text, (m) => {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '半角标点', c_index, pre + m.index, m[0].length, ErrorCode.FoundH2fPunc));
            return false;
        });

        findAllAndProcess(/[っ]/g, cgrps.text, (m) => {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '日语没删', c_index, pre + m.index, m[0].length, ErrorCode.FoundKana));
            return false;
        });

        checkExclamationQuestion && findAllAndProcess(/！？/g, cgrps.text, (m) => {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '应改成？！', c_index, pre + m.index, m[0].length, ErrorCode.ExclamationQuestion));
            return false;
        });

        if (checkPuncComb) {
            let snake = config.get("formatter.a.wave.specify") as string;
            const regStr = `(……?|——?|${snake})[。、，]`;
            findAllAndProcess(new RegExp(regStr, 'g'), cgrps.text, (m) => {
                res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '标点符号使用不规范', c_index, pre + m.index, m[0].length, ErrorCode.WrongPuncComb));
                return false;
            });
        }

        if (checkUnusualCharacter) {
            try {
                const content = cgrps.text;
                for (let i = 0; i < content.length; i++) {
                    const buf = iconv.encode(content[i], 'gb2312');
                    if (buf.length < 2) {
                        continue;
                    }
                    if (buf[0] < 0xA1 || buf[0] > 0xF7 || buf[1] < 0xA1 || buf[1] > 0xFE) {
                        if (escapedSet.has(content[i])) {
                            continue;
                        }
                        const d = createDiagnostic(vscode.DiagnosticSeverity.Warning, '疑似不常用的汉字', c_index, cgrps.prefix.length + cgrps.white.length + i, 1);
                        d.code = ErrorCode.UnusualCharacter;
                        res.push(d);
                    }
                }
                

            } catch (e) {
                res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '可能包含不常用的汉字', c_index, cgrps.prefix.length + cgrps.white.length, cgrps.text.length));
            }
        }

    });
    return [res, untranslatedLines];
}

export function createDiagnostic(level: vscode.DiagnosticSeverity, message: string, lineNumber: number, start: number, length: number, code?: number) {
    const range = new vscode.Range(lineNumber, start, lineNumber, start + length);
    const diagnostic = new vscode.Diagnostic(
        range,
        message,
        level
    );
    if (code) {
        diagnostic.code = code;
    }
    return diagnostic;
}

export function createErrorDiagnostic(message: string, lineNumber: number, length: number) {
    return createDiagnostic(vscode.DiagnosticSeverity.Error, message, lineNumber, 0, length);
}

export function createErrorDiagnosticMultiLine(message: string, startLine: number, endLine: number) {
    const range = new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
    const diagnostic = new vscode.Diagnostic(
        range,
        message,
        vscode.DiagnosticSeverity.Error
    );
    return diagnostic;
}

export function clearAllWarnings() {
    DltxtDiagCollection.clear();
    DltxtDiagCollectionMissionLine.clear();
    DltxtDiagCollectionSpellcheck.clear();
}
