import * as vscode from 'vscode';
import { getOrCreateDiagnosticCollection } from './utils';
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
    const [showError, diagnostics] = DocumentParser.errorCheck(activeEditor.document);

    if (showError) {
        diagnosticCollection.set(activeEditor.document.uri, diagnostics);
    }
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