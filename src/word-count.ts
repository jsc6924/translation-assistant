import * as vscode from 'vscode';
import { IDocumentParser, DocumentProcessor, DocumentProcessedListener, MatchedGroups } from './parser';
import { Pair, SizedCache } from './utils';

export const WordCountStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

export function activate(context: vscode.ExtensionContext) {
    // nothing to do now
}

class WordCountProcessor implements DocumentProcessor {
    private totalWordCount: number = 0;
    private beforeCursorWordCount: number = 0;
    private cursorLine: number = 0;
    private processedLineIndexs: Set<number> = new Set();
    public constructor(private document: vscode.TextDocument) {}

    startProcess(): void {
        const activeEditor = vscode.window.activeTextEditor;
        this.cursorLine = activeEditor?.selection.active.line ?? 0;
    }

    processLine(jgrps: MatchedGroups, cgrps: MatchedGroups, j_index: number, c_index: number, talkingName?: string): void {
        // only count the original line once
        if (this.processedLineIndexs.has(j_index)) {
            return;
        }
        this.processedLineIndexs.add(j_index);

        const lineNumber = j_index;
        const wordCount = jgrps.text.trim().length;
        this.totalWordCount += wordCount;
        if (lineNumber <= this.cursorLine) {
            this.beforeCursorWordCount += wordCount;
        }
    }

    endProcess(): void {
        if (this.totalWordCount === 0) {
            WordCountStatusBarItem.hide();
            return;
        }
        WordCountStatusBarItem.text = `字数统计: ${this.beforeCursorWordCount}/${this.totalWordCount}字`;
        WordCountStatusBarItem.show();
    }
}

export class WordCountListener implements DocumentProcessedListener {
    getProcessor(doc: vscode.TextDocument): DocumentProcessor | null {
        if (vscode.window.activeTextEditor?.document !== doc) {
            return null;
        }
        return new WordCountProcessor(doc);
    }
}
