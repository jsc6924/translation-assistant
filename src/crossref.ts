import * as vscode from 'vscode'
import { DocumentParser, MatchedGroups } from './parser';
import { Pair, Tuple3, removeSpace } from './utils';
import { batchProcess } from './batch';
import { LineInfo, LineSearchResult, MemoryCrossrefIndex, SearchIndex, Tokenizer } from './translation-db';
import { path } from './user-script-api';
import { Semaphore } from 'async-mutex';
import { channel } from './dlbuild';

class TextLocation {
    constructor(public uriIndex: number, public line: number, public ctext: string) { }
}

class ProjectIdx {
    private searchIndex: MemoryCrossrefIndex;
    static lock = new Semaphore(1);
    constructor() {
        this.searchIndex = new MemoryCrossrefIndex();
    }

    public async update(context: vscode.ExtensionContext, documentUris?: vscode.Uri[]) {
        await ProjectIdx.lock.acquire();
        try {
            await this.updateImpl(context, documentUris);
        } finally {
            ProjectIdx.lock.release();
        }
    }

    private async updateImpl(context: vscode.ExtensionContext, documentUris?: vscode.Uri[]) {
        const uris = documentUris || await vscode.workspace.findFiles('**/*.{txt,TXT}', '**/.*/**', undefined, undefined);
        if (!uris) {
            return;
        }
        const tokenizer = await Tokenizer.getAsync(context);
        await batchProcess(uris, (doc, i) => {
            this.searchIndex.update(doc.uri.fsPath, () => {
                const jlines: string[] = [];
                const jLineNumbers: number[] = [];
                const clines: string[] = [];
                DocumentParser.processPairedLines(doc, (jgrps: MatchedGroups, cgrps: MatchedGroups, j_index: number, c_index: number) => {

                    jlines.push(tokenizer.tokenize(jgrps.text));
                    jLineNumbers.push(j_index);
                    clines.push(cgrps.text);
                });
                return [jlines, jLineNumbers, clines];
            })
        }, false);
    }

    public async search(context: vscode.ExtensionContext, query: string, threshold: number, limit: number): Promise<[LineSearchResult[], number]> {
        const tokenizer = await Tokenizer.getAsync(context);
        const queryTokens = tokenizer.tokenize(query);
        return this.searchIndex.search(queryTokens, threshold, limit);
    }
}
export const InMemProjectIndex = new ProjectIdx();

function textNormalize(key: string) {
    return key;
}


const similarTextCache = new Map<string, vscode.DecorationOptions[]>();
const exactMatchCache = new Map<string, vscode.DecorationOptions[]>();
let lastCheckTime = 0;

export async function checkSimilarText(context: vscode.ExtensionContext) {
    const documentUris = await vscode.workspace.findFiles('**/*.{txt,TXT}', '**/.*/**', undefined, undefined)
    if (!documentUris) {
        return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }


    const exactMatchStyle = DecoManager.getExactMatchDecorationType();
    const similarTextStyle = DecoManager.getSimilarTextDecorationType();
    activeEditor.setDecorations(exactMatchStyle, []);
    activeEditor.setDecorations(similarTextStyle, []);
    const currentDoc = activeEditor.document;
    const currentTime = Date.now();
    if ((currentTime - lastCheckTime < 600000) && similarTextCache.has(currentDoc.uri.fsPath) && exactMatchCache.has(currentDoc.uri.fsPath)) {
        activeEditor.setDecorations(similarTextStyle, similarTextCache.get(currentDoc.uri.fsPath)!);
        activeEditor.setDecorations(exactMatchStyle, exactMatchCache.get(currentDoc.uri.fsPath)!);
        return;
    }

    await InMemProjectIndex.update(context, documentUris);

    const tokenizer = await Tokenizer.getAsync(context);
    const jtexts: string[] = [];
    const jLineNumbers: number[] = [];
    DocumentParser.processPairedLines(currentDoc, (jgrps: MatchedGroups, cgrps: MatchedGroups, j_index: number, c_index: number) => {   
        const jtext = tokenizer.tokenize(textNormalize(jgrps.text));
        jtexts.push(jtext);
        jLineNumbers.push(j_index);
        
    });

    let modeFinder: number[] = []; // ref count, num of text that has this count
    const lineNumberAndRefs: Tuple3<number, LineSearchResult[], number>[] = [];
    const config = vscode.workspace.getConfiguration("dltxt");
    const threshold = config.get<number>('appearance.z.similarTextThreshold', 80);
    const limit = config.get<number>('appearance.z.similarTextLimit', 10);
    const t0 = Date.now();
    for (let i = 0; i < jtexts.length; i++) {
        let [similarLines, exactCount] = await InMemProjectIndex.search(context, jtexts[i], threshold, limit);
        similarLines = similarLines.filter(l => l.lineInfo.fileName !== currentDoc.uri.fsPath || l.lineInfo.lineNumber !== jLineNumbers[i]);
        lineNumberAndRefs.push([jLineNumbers[i], similarLines, exactCount]);
        modeFinder[exactCount] = (modeFinder[exactCount] ?? 0) + 1;
    }
    channel.appendLine(`search time: ${Date.now() - t0} ms for ${jtexts.length} lines.`);

    let maxCount = 0, lenWithMaxCount = 0;
    for(let i = 0; i + 1 < modeFinder.length; i++) {
        if (modeFinder[i] !== undefined && modeFinder[i] > maxCount) {
            maxCount = modeFinder[i];
            lenWithMaxCount = i;
        }
    }
    const minNoticableLen = lenWithMaxCount + 1; // without this number of exact matches, it will not be shown

    const exactMatchDecos = [] as vscode.DecorationOptions[];
    const similarTextDecos = [] as vscode.DecorationOptions[];
    const tableHeaders = `#### 相似文本\n\n| 文件 | 相似度 | 原文 | 译文 |`;
    const tableSeparator = `|---|---|---|---|`;
    const t1 = Date.now();
    for (const [line, refs, exactCount] of lineNumberAndRefs) {
        const lineRange = new vscode.Range(line, 0, line, 1000);
        // Generate all the table rows by mapping over your refs array
        const tableRows = refs.map(r => {
            const shortFileName = `${path.basename(r.lineInfo.fileName)}:${r.lineInfo.lineNumber+1}`;
            const escapedFullPathForTooltip = r.lineInfo.fileName.replace(/"/g, '&quot;');
            const fileUriWithLine = vscode.Uri.file(r.lineInfo.fileName).with({ 
    fragment: `L${r.lineInfo.lineNumber + 1}` 
});

            // This is the content for the first column (File)
            const fileNameCellContent = `[${shortFileName}](${fileUriWithLine.toString()} "${escapedFullPathForTooltip}")`;

            // Your existing copy command
            const copyCommand = `[copy](command:Extension.dltxt.copyToClipboard?{"text":"${encodeURIComponent(r.lineInfo.trLine)}"})`;

            // Construct a single table row for the current reference
            // Each part is a cell, separated by '|'
            return `| ${fileNameCellContent} | ${r.score.toFixed(3)} | ${removeSpace(r.lineInfo.jpLine)} | ${r.lineInfo.trLine} ${copyCommand} |`;
        }).join('\n');
        const fullMarkdown = `${tableHeaders}\n${tableSeparator}\n${tableRows}`;
        const msg = new vscode.MarkdownString(fullMarkdown);
        msg.isTrusted = true;
        const deco = { range: lineRange, hoverMessage: msg };

        if (exactCount < limit) {
            if (exactCount >= minNoticableLen) {
                exactMatchDecos.push(deco);
            } else if (refs.length > 0) {
                similarTextDecos.push(deco);
            }
        }
    }
    channel.appendLine(`decoration time: ${Date.now() - t1} ms for ${jtexts.length} lines.`);
    lastCheckTime = Date.now();
    activeEditor.setDecorations(exactMatchStyle, exactMatchDecos);
    activeEditor.setDecorations(similarTextStyle, similarTextDecos);
    exactMatchCache.set(currentDoc.uri.fsPath, exactMatchDecos);
    similarTextCache.set(currentDoc.uri.fsPath, similarTextDecos);
}

class DecoManager {
    private static exactMatchDecorationType: vscode.TextEditorDecorationType | undefined;
    private static similarTextDecorationType: vscode.TextEditorDecorationType | undefined;
    public static getExactMatchDecorationType(): vscode.TextEditorDecorationType {
        if (!this.exactMatchDecorationType) {
            this.exactMatchDecorationType = createExactMatchTextDecorationType();
        }
        return this.exactMatchDecorationType;
    }
    public static getSimilarTextDecorationType(): vscode.TextEditorDecorationType {
        if (!this.similarTextDecorationType) {
            this.similarTextDecorationType = createSimilarTextDecorationType();
        }
        return this.similarTextDecorationType;
    }
}

function createExactMatchTextDecorationType() {
    let obj = {
        isWholeLine: true,
        borderStyle: 'none',
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        light: {
            // this color will be used in light color themes
            overviewRulerColor: 'rgb(183, 178, 239)',
            backgroundColor: 'rgb(183, 178, 239)'
        },
        dark: {
            // this color will be used in dark color themes
            overviewRulerColor: 'rgb(72, 71, 104)',
            backgroundColor: 'rgb(72, 71, 104)'
        }
    };
      
  return vscode.window.createTextEditorDecorationType(obj);
}

function createSimilarTextDecorationType() {
    let obj = {
        isWholeLine: false,
        borderStyle: 'none',
        light: {
            // this color will be used in light color themes
            overviewRulerColor: 'rgba(183, 178, 239, 0.3)',
            backgroundColor: 'rgba(183, 178, 239, 0.3)'
        },
        dark: {
            // this color will be used in dark color themes
            overviewRulerColor: 'rgba(72, 71, 104, 0.3)',
            backgroundColor: 'rgba(72, 71, 104, 0.3)'
      }
  };
      
  return vscode.window.createTextEditorDecorationType(obj);
}


export function activate(context: vscode.ExtensionContext) {
    vscode.window.onDidChangeActiveTextEditor(editor => {
        const config = vscode.workspace.getConfiguration("dltxt");
        const enable = config.get<boolean>('appearance.z.checkSimilarTextOnSwitchTab');
        if (enable && editor) {
            checkSimilarText(context);
        }
    });

    vscode.workspace.onDidCloseTextDocument(doc => {
        similarTextCache.delete(doc.uri.fsPath);
        exactMatchCache.delete(doc.uri.fsPath);
    });
    const config = vscode.workspace.getConfiguration("dltxt");
    if (config.get<boolean>('appearance.z.checkSimilarTextOnSwitchTab')) {
        checkSimilarText(context);
    }

}