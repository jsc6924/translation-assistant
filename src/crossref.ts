import * as vscode from 'vscode'
import { DocumentParser, MatchedGroups } from './parser';
import { Pair, Tuple3, removeSpace } from './utils';
import { batchProcess } from './batch';
import { LineInfo, LineSearchResult, MemoryCrossrefIndex, SearchIndex, Tokenizer } from './translation-db';
import { path } from './user-script-api';
import { Semaphore } from 'async-mutex';
import { channel } from './dlbuild';
import { getLanguageClient, RequestGetSimilarText, ResGetSimilarText, SimilarTextMatch } from './lspclient';
import { getRegexConfigPayload } from './parser';

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
        await batchProcess(uris, async (doc, i) => {
            await this.searchIndex.update(doc.uri.fsPath,() => {
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
        }, false, 16);
    }

    public async search(context: vscode.ExtensionContext, query: string, threshold: number, limit: number, curFilePath: string, curLineNumber  : number): Promise<[LineSearchResult[], number]> {
        const tokenizer = await Tokenizer.getAsync(context);
        const queryTokens = tokenizer.tokenize(query);
        return this.searchIndex.search(queryTokens, threshold, limit, curFilePath, curLineNumber);
    }
}
export const InMemProjectIndex = new ProjectIdx();

function textNormalize(key: string) {
    return key;
}

type SimilarTextBackend = 'legacy' | 'bridge';

type SimilarTextRefLike = {
    lineInfo: {
        fileName: string;
        lineNumber: number;
        jpLine: string;
        trLine: string;
    };
    score: number;
};

type SimilarTextMatchLike = {
    lineNumber: number;
    refs: SimilarTextRefLike[];
    exactCount: number;
};

function getSimilarTextBackend(): SimilarTextBackend {
    const config = vscode.workspace.getConfiguration("dltxt");
    const backend = config.get<string>('appearance.z.similarTextImplementation', 'legacy');
    return backend === 'bridge' ? 'bridge' : 'legacy';
}

function cacheKey(document: vscode.TextDocument, backend: SimilarTextBackend): string {
    return `${backend}:${document.uri.fsPath}`;
}

function isSupportedSimilarTextDocument(document: vscode.TextDocument): boolean {
    return document.uri.scheme === 'file'
        && document.uri.fsPath.toLowerCase().endsWith('.txt');
}

function renderAndCacheDecorations(
    editor: vscode.TextEditor,
    document: vscode.TextDocument,
    backend: SimilarTextBackend,
    matches: SimilarTextMatchLike[]) {
    const exactMatchStyle = DecoManager.getExactMatchDecorationType();
    const similarTextStyle = DecoManager.getSimilarTextDecorationType();
    const exactMatchDecos = [] as vscode.DecorationOptions[];
    const similarTextDecos = [] as vscode.DecorationOptions[];
    const tableHeaders = `#### 相似文本\n\n| 文件 | 相似度 | 原文 | 译文 |`;
    const tableSeparator = `|---|---|---|---|`;

    for (const { lineNumber: line, refs, exactCount } of matches) {
        const lineRange = new vscode.Range(line, 0, line, 1000);
        const tableRows = refs.map(r => {
            const shortFileName = `${path.basename(r.lineInfo.fileName)}:${r.lineInfo.lineNumber+1}`;
            const escapedFullPathForTooltip = r.lineInfo.fileName.replace(/"/g, '&quot;');
            const fileUriWithLine = vscode.Uri.file(r.lineInfo.fileName).with({
                fragment: `L${r.lineInfo.lineNumber + 1}`
            });

            const fileNameCellContent = `[${shortFileName}](${fileUriWithLine.toString()} "${escapedFullPathForTooltip}")`;
            const copyCommand = `[copy](command:Extension.dltxt.copyToClipboard?{"text":"${encodeURIComponent(r.lineInfo.trLine)}"})`;
            return `| ${fileNameCellContent} | ${r.score.toFixed(3)} | ${removeSpace(r.lineInfo.jpLine)} | ${r.lineInfo.trLine} ${copyCommand} |`;
        }).join('\n');
        const fullMarkdown = `${tableHeaders}\n${tableSeparator}\n${tableRows}`;
        const msg = new vscode.MarkdownString(fullMarkdown);
        msg.isTrusted = true;
        const deco = { range: lineRange, hoverMessage: msg };

        if (exactCount > 0) {
            exactMatchDecos.push(deco);
        } else if (refs.length > 0) {
            similarTextDecos.push(deco);
        }
    }

    const key = cacheKey(document, backend);
    editor.setDecorations(exactMatchStyle, exactMatchDecos);
    editor.setDecorations(similarTextStyle, similarTextDecos);
    exactMatchCache.set(key, exactMatchDecos);
    similarTextCache.set(key, similarTextDecos);
}

function showCachedDecorations(editor: vscode.TextEditor, backend: SimilarTextBackend) {
    const exactMatchStyle = DecoManager.getExactMatchDecorationType();
    const similarTextStyle = DecoManager.getSimilarTextDecorationType();
    const key = cacheKey(editor.document, backend);

    if (similarTextCache.has(key) && exactMatchCache.has(key)) {
        editor.setDecorations(similarTextStyle, similarTextCache.get(key)!);
        editor.setDecorations(exactMatchStyle, exactMatchCache.get(key)!);
    } else {
        editor.setDecorations(exactMatchStyle, []);
        editor.setDecorations(similarTextStyle, []);
    }
}

async function collectLegacySimilarText(context: vscode.ExtensionContext, currentDoc: vscode.TextDocument): Promise<SimilarTextMatchLike[]> {
    const documentUris = await vscode.workspace.findFiles('**/*.{txt,TXT}', '**/.*/**', undefined, undefined);
    if (!documentUris) {
        return [];
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

    const lineNumberAndRefs: SimilarTextMatchLike[] = [];
    const config = vscode.workspace.getConfiguration("dltxt");
    const threshold = config.get<number>('appearance.z.similarTextThreshold', 80);
    const limit = config.get<number>('appearance.z.similarTextLimit', 10);

    const blockSize = 64;
    for (let i = 0; i < jtexts.length; i += blockSize) {
        const allPromises: Promise<void>[] = [];
        for (let j = i; j < i + blockSize && j < jtexts.length; j++) {
            allPromises.push(InMemProjectIndex.search(context, jtexts[j], threshold, limit, currentDoc.uri.fsPath, jLineNumbers[j]).then(([similarLines, exactCount]) => {
                if (exactCount < limit && similarLines.length > 0) {
                    lineNumberAndRefs.push({
                        lineNumber: jLineNumbers[j],
                        refs: similarLines,
                        exactCount,
                    });
                }
            }));
        }
        await Promise.all(allPromises);
    }

    return lineNumberAndRefs;
}

async function collectBridgeSimilarText(currentDoc: vscode.TextDocument): Promise<SimilarTextMatchLike[]> {
    const client = getLanguageClient();
    if (!client) {
        throw new Error('language client is unavailable');
    }

    const config = vscode.workspace.getConfiguration("dltxt");
    const threshold = config.get<number>('appearance.z.similarTextThreshold', 80);
    const limit = config.get<number>('appearance.z.similarTextLimit', 10);
    const response: ResGetSimilarText = await client.sendRequest(RequestGetSimilarText, {
        uri: currentDoc.uri.toString(),
        threshold,
        limit,
    });

    return response.matches.filter((match: SimilarTextMatch) => match.exactCount < limit && match.refs.length > 0);
}


const similarTextCache = new Map<string, vscode.DecorationOptions[]>();
const exactMatchCache = new Map<string, vscode.DecorationOptions[]>();
let lastCheckTime = 0;
let checkTimeout: NodeJS.Timeout | undefined;

async function runSimilarTextCheck(context: vscode.ExtensionContext) {
    if (checkTimeout) {
        clearTimeout(checkTimeout);
        checkTimeout = undefined;
    }

    const documentUris = await vscode.workspace.findFiles('**/*.{txt,TXT}', '**/.*/**', undefined, undefined)
    if (!documentUris) {
        return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }

    if (!isSupportedSimilarTextDocument(activeEditor.document)) {
        activeEditor.setDecorations(DecoManager.getExactMatchDecorationType(), []);
        activeEditor.setDecorations(DecoManager.getSimilarTextDecorationType(), []);
        return;
    }


    const currentDoc = activeEditor.document;
    const configuredBackend = getSimilarTextBackend();
    showCachedDecorations(activeEditor, configuredBackend);

    const executeCheck = async () => {
        const stillActiveEditor = vscode.window.activeTextEditor;
        if (!stillActiveEditor || stillActiveEditor.document.uri.fsPath !== currentDoc.uri.fsPath) {
            return;
        }

        const t0 = Date.now();

        let backendUsed = configuredBackend;
        let matches: SimilarTextMatchLike[] = [];
        try {
            if (configuredBackend === 'bridge') {
                matches = await collectBridgeSimilarText(currentDoc);
            } else {
                matches = await collectLegacySimilarText(context, currentDoc);
            }
        } catch (error) {
            if (configuredBackend !== 'bridge') {
                throw error;
            }

            channel.appendLine(`bridge similar text failed, fallback to legacy: ${String(error)}`);
            backendUsed = 'legacy';
            matches = await collectLegacySimilarText(context, currentDoc);
        }

        channel.appendLine(`search time: ${Date.now() - t0} ms for ${matches.length} lines in total. backend=${backendUsed}`);
        lastCheckTime = Date.now();
        renderAndCacheDecorations(stillActiveEditor, currentDoc, backendUsed, matches);
    };
    
    if (configuredBackend === 'bridge') {
        await executeCheck();
        return;
    }

    // for legacy backend, if the check takes too long, delay it to avoid blocking UI
    checkTimeout = setTimeout(() => {
        void executeCheck();
    }, 5000);
}

export async function checkSimilarText(context: vscode.ExtensionContext) {
    await runSimilarTextCheck(context);
}

export async function handleBridgeCrossrefIndexReady(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("dltxt");
    if (!config.get<boolean>('appearance.z.checkSimilarTextOnSwitchTab')) {
        return;
    }

    if (getSimilarTextBackend() !== 'bridge') {
        return;
    }

    await runSimilarTextCheck(context);
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
    vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
        const config = vscode.workspace.getConfiguration("dltxt");
        const enable = config.get<boolean>('appearance.z.checkSimilarTextOnSwitchTab');
        if (enable && editor) {
            checkSimilarText(context);
        } else if (editor && !isSupportedSimilarTextDocument(editor.document)) {
            editor.setDecorations(DecoManager.getExactMatchDecorationType(), []);
            editor.setDecorations(DecoManager.getSimilarTextDecorationType(), []);
        }
    });

    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
        if (!event.affectsConfiguration('dltxt.appearance.z.checkSimilarTextOnSwitchTab')
            && !event.affectsConfiguration('dltxt.appearance.z.similarTextThreshold')
            && !event.affectsConfiguration('dltxt.appearance.z.similarTextLimit')
            && !event.affectsConfiguration('dltxt.appearance.z.similarTextImplementation')) {
            return;
        }

        const config = vscode.workspace.getConfiguration("dltxt");
        const enable = config.get<boolean>('appearance.z.checkSimilarTextOnSwitchTab');
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }

        if (!isSupportedSimilarTextDocument(activeEditor.document)) {
            activeEditor.setDecorations(DecoManager.getExactMatchDecorationType(), []);
            activeEditor.setDecorations(DecoManager.getSimilarTextDecorationType(), []);
            return;
        }

        if (!enable) {
            activeEditor.setDecorations(DecoManager.getExactMatchDecorationType(), []);
            activeEditor.setDecorations(DecoManager.getSimilarTextDecorationType(), []);
            return;
        }

        checkSimilarText(context);
    });

    vscode.workspace.onDidCloseTextDocument((doc: vscode.TextDocument) => {
        similarTextCache.delete(cacheKey(doc, 'legacy'));
        similarTextCache.delete(cacheKey(doc, 'bridge'));
        exactMatchCache.delete(cacheKey(doc, 'legacy'));
        exactMatchCache.delete(cacheKey(doc, 'bridge'));
    });
    const config = vscode.workspace.getConfiguration("dltxt");
    if (config.get<boolean>('appearance.z.checkSimilarTextOnSwitchTab')) {
        checkSimilarText(context);
    }

}