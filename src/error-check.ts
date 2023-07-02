import * as vscode from 'vscode';
import { getOrCreateDiagnosticCollection } from './utils';
import { getRegex } from './formatter';

export function updateErrorDecorations() {
    const config = vscode.workspace.getConfiguration("dltxt");
    let activeEditor = vscode.window.activeTextEditor;
    
    if (!activeEditor) {
        return;
    }
    const fileName = activeEditor.document.fileName;
    if(!fileName.endsWith('.txt')) {
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
    const checkPrefixTag = config.get<boolean>('appearance.showError.checkPrefixTag');
    const checkDeletedLines = config.get<boolean>('appearance.showError.checkDeletedLines');
    const diagnostics: vscode.Diagnostic[] = [];
    const valid_regs = getRegex();

    let matched_count = 0;
    let prev_matched_i = -1;

    for (let lineNumber = 0; lineNumber < activeEditor.document.lineCount; lineNumber++) {
        const lineText = activeEditor.document.lineAt(lineNumber).text;
        if (!lineText) {
            continue;
        }
        let matched = false;
        for(let i = 0; !matched && i < valid_regs.length; i++) {
            const reg = valid_regs[i];
            if (reg && reg.test(lineText)) {
                if (checkDeletedLines) {
                    if (i == 0 && prev_matched_i == 0) {
                        diagnostics.push(createErrorDiagnostic('译文行被删除', lineNumber, lineText.length));
                    } else if (i == 1 && prev_matched_i == 1) {
                        diagnostics.push(createErrorDiagnostic('原文行被删除', lineNumber, lineText.length));
                    }
                }
                prev_matched_i = i;
                matched = true;
            }
        }
        if (!matched) {
            if (checkPrefixTag) {
                diagnostics.push(createErrorDiagnostic('标签格式错误', lineNumber, lineText.length));
            }
        } else {
            matched_count++;
        }
    }
    //在错误数小于正确数时才报告错误
    if (diagnostics.length < matched_count) {
        diagnosticCollection.set(activeEditor.document.uri, diagnostics);
    }
}

function createErrorDiagnostic(message: string, lineNumber: number, length: number) {
    const range = new vscode.Range(lineNumber, 0, lineNumber, length);
    const diagnostic = new vscode.Diagnostic(
        range,
        message,
        vscode.DiagnosticSeverity.Error
    );
    return diagnostic;
}