import * as vscode from 'vscode';
import { VSCodeContext, findAllAndProcess, DltxtDiagCollection, DltxtDiagCollectionMissionLine, DltxtDiagCollectionSpellcheck } from './utils';
import { DocumentParser, MatchedGroups } from './parser';
import { shouldSkipChecking } from './utils';
import { getTextDelimiter } from './motion';

// not used yet, can be used to diagnostic 
export enum ErrorCode {
    Untranslated = 1,
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
            config.get<boolean>('appearance.warning.enable') && diagnostics.push(...warningDiagnostics);
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
    const nameRegex = /na?me/gi;
    const skipChecking = (cgrps: MatchedGroups) => {
        if (nameRegex.test(cgrps.prefix) || shouldSkipChecking(cgrps.white + cgrps.text + cgrps.suffix, delims)) {
            return true;
        }
        return false;
    }

    DocumentParser.processPairedLines(document, (jgrps, cgrps, j_index, c_index) => {
        if (jgrps.text === cgrps.text) {
            if (!skipChecking(cgrps)) {
                untranslatedLines.push(c_index);
            }
            return;
        }
        const pre = cgrps.prefix.length + cgrps.white.length;

        findAllAndProcess( /(\.{2,})|(。{2,})/g, cgrps.text, (m) => {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '不规范的省略号', c_index, pre + m.index, m[0].length));
            return false;
        });

        {
            let target = config.get("formatter.a.wave.specify") as string;
            const regStr = `[~∼〜～]`.replace(new RegExp(target, 'g'), '');
            findAllAndProcess(new RegExp(regStr, 'g'), cgrps.text, (m) => {
                res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '不规范的波浪号', c_index, pre + m.index, m[0].length));
                return false;
            });
        }
        
        findAllAndProcess(/[―ー－]+/g, cgrps.text, (m) => {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '不规范的破折号', c_index, pre + m.index, m[0].length));
            return false;
        });

        findAllAndProcess(/。[」』]/g, cgrps.text + cgrps.suffix, (m) => {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '引号中的句尾应省略句号', c_index, pre + m.index, m[0].length));
            return false;
        });

        {
            let snake = config.get("formatter.a.wave.specify") as string;
            const regStr = `(……?|——?|${snake})[。、，]`;
            findAllAndProcess(new RegExp(regStr, 'g'), cgrps.text, (m) => {
                res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '标点符号使用不规范', c_index, pre + m.index, m[0].length));
                return false;
            });
        }

    });
    return [res, untranslatedLines];
}

export function createDiagnostic(level: vscode.DiagnosticSeverity, message: string, lineNumber: number, start: number, length: number) {
    const range = new vscode.Range(lineNumber, start, lineNumber, start + length);
    const diagnostic = new vscode.Diagnostic(
        range,
        message,
        level
    );
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
