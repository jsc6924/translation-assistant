import * as vscode from 'vscode';
import { VSCodeContext, getOrCreateDiagnosticCollection } from './utils';
import { DocumentParser } from './parser';

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
    const [showError, diagnostics] = 
    DocumentParser.errorCheck(activeEditor.document);

    if (showError) {
        diagnosticCollection.set(activeEditor.document.uri, diagnostics);
    } else {

        diagnosticCollection.set(activeEditor.document.uri, [
            createInfoDiagnostic(`发现太多错误，没有全部显示。可能没有配置正确，或者这个文本不是双行文本。第一个错误：${diagnostics[0]?.message} Line: ${diagnostics[0]?.range?.start?.line}`, 0, 1)
        ]);
    }
}

export function createInfoDiagnostic(message: string, lineNumber: number, length: number) {
    const range = new vscode.Range(lineNumber, 0, lineNumber, length);
    const diagnostic = new vscode.Diagnostic(
        range,
        message,
        vscode.DiagnosticSeverity.Information
    );
    return diagnostic;
}

export function createErrorDiagnostic(message: string, lineNumber: number, length: number) {
    const range = new vscode.Range(lineNumber, 0, lineNumber, length);
    const diagnostic = new vscode.Diagnostic(
        range,
        message,
        vscode.DiagnosticSeverity.Error
    );
    return diagnostic;
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