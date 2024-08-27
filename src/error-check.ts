import * as vscode from 'vscode';
import { VSCodeContext, findAllAndProcess, getOrCreateDiagnosticCollection } from './utils';
import { DocumentParser, MatchedGroups } from './parser';
import { shouldSkipChecking } from './utils';
import { getTextDelimiter } from './motion';

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
    const diagnosticCollection = getOrCreateDiagnosticCollection(fileName);
    if (!diagnosticCollection) {
        return;
    }
    diagnosticCollection.clear();
    let bShow = config.get<boolean>('appearance.showError.all');
    if (!bShow) {
        return;
    }
    const [showError, diagnostics] = DocumentParser.errorCheck(activeEditor.document);

    if (showError) {
        const checkWarning = config.get<boolean>('appearance.warning.enable');
        const checkMissingTranslation = config.get<boolean>('appearance.warning.enableDynamicMissingTranslationCheck') as boolean;
        if (checkWarning) {
            const warningDiagnostics = warningCheck(activeEditor.document, checkMissingTranslation, true);
            diagnostics.push(...warningDiagnostics);
        }
        diagnosticCollection.set(activeEditor.document.uri, diagnostics);
    } else {

        diagnosticCollection.set(activeEditor.document.uri, [
            createDiagnostic(vscode.DiagnosticSeverity.Information, `发现太多错误，没有全部显示。可能没有配置正确，或者这个文本不是双行文本。第一个错误：${diagnostics[0]?.message} Line: ${diagnostics[0]?.range?.start?.line}`, 0, 0, 1)
        ]);
    }
}

function warningCheck(document: vscode.TextDocument, checkMissingTranslation: boolean, isDynamic: boolean): vscode.Diagnostic[] {
    const res = [] as vscode.Diagnostic[];
    let untranslatedLines = [] as number[];
    const config = vscode.workspace.getConfiguration("dltxt");
    const delims = getTextDelimiter();
    const nameRegex = /na?me/gi;
    const skipChecking = (cgrps: MatchedGroups) => {
        if (nameRegex.test(cgrps.prefix) || shouldSkipChecking(cgrps.text, delims)) {
            return true;
        }
        return false;
    }

    DocumentParser.processPairedLines(document, (jgrps, cgrps, j_index, c_index) => {
        if (jgrps.text === cgrps.text) {
            if (checkMissingTranslation && !skipChecking(cgrps)) {
                untranslatedLines.push(c_index);
            }
            return;
        }
        if (checkMissingTranslation) {
            for (const i of untranslatedLines) {
                res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '未翻译', i, 0, 1000));
            }
            untranslatedLines = [];
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
    if (!isDynamic && checkMissingTranslation) {
        for (const i of untranslatedLines) {
            res.push(createDiagnostic(vscode.DiagnosticSeverity.Warning, '未翻译', i, 0, 1000));
        }
    }
    return res;
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
