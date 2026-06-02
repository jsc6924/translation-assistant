import * as vscode from 'vscode';
import { DictSettings, DictKeyInfo, DictType, DictNamingRule, DictNamingValue, getDictNamingComment, getDictNamingTranslation } from './utils';
const AhoCorasick = require('ahocorasick');
import { DecorationMemoryStorage } from './simpletm';
import { DocumentParser, MatchedGroups } from './parser';

interface LineSegment {
    start: number;
    end: number;
}

const parserSyntaxDecorationTypes = {
    baseText: vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('editor.foreground')
    }),
    originalPrefix: vscode.window.createTextEditorDecorationType({
        light: {
            color: '#78a57e'
        },
        dark: {
            color: '#5f8b66'
        }
    }),
    originalText: vscode.window.createTextEditorDecorationType({
        light: {
            color: '#0f6b2e'
        },
        dark: {
            color: '#d7ffd7'
        }
    }),
    translatedPrefix: vscode.window.createTextEditorDecorationType({
        light: {
            color: '#8c8c8c'
        },
        dark: {
            color: '#8c8c8c'
        }
    }),
    translatedText: vscode.window.createTextEditorDecorationType({
        light: {
            color: '#202020'
        },
        dark: {
            color: '#f0f0f0'
        }
    }),
    nameText: vscode.window.createTextEditorDecorationType({
        light: {
            color: '#114b8d'
        },
        dark: {
            color: '#7cb8c5'
        }
    })
};

export function updateParserSyntaxDecorations() {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }

    if (!shouldApplyParserSyntaxDecorations(activeEditor)) {
        clearParserSyntaxDecorations(activeEditor);
        return;
    }

    const baseRanges: vscode.Range[] = [];
    const originalPrefixRanges: vscode.Range[] = [];
    const originalTextRanges: vscode.Range[] = [];
    const translatedPrefixRanges: vscode.Range[] = [];
    const translatedTextRanges: vscode.Range[] = [];
    const nameRanges = DocumentParser.collectNameRanges(activeEditor.document);
    const nameLineSegments = buildLineSegmentsByLine(activeEditor.document, nameRanges);

    for (let line = 0; line < activeEditor.document.lineCount; line++) {
        const textLine = activeEditor.document.lineAt(line);
        if (textLine.text.length > 0) {
            baseRanges.push(new vscode.Range(line, 0, line, textLine.text.length));
        }
    }

    try {
        DocumentParser.processPairedLines(activeEditor.document, (jgrps, cgrps, j_index, c_index) => {
            addSegmentRanges(activeEditor.document, j_index, jgrps, originalPrefixRanges, originalTextRanges, nameLineSegments.get(j_index) ?? []);
            addSegmentRanges(activeEditor.document, c_index, cgrps, translatedPrefixRanges, translatedTextRanges, nameLineSegments.get(c_index) ?? []);
        });
    } catch {
        clearParserSyntaxDecorations(activeEditor);
        return;
    }

    activeEditor.setDecorations(parserSyntaxDecorationTypes.baseText, baseRanges);
    activeEditor.setDecorations(parserSyntaxDecorationTypes.originalPrefix, originalPrefixRanges);
    activeEditor.setDecorations(parserSyntaxDecorationTypes.originalText, originalTextRanges);
    activeEditor.setDecorations(parserSyntaxDecorationTypes.translatedPrefix, translatedPrefixRanges);
    activeEditor.setDecorations(parserSyntaxDecorationTypes.translatedText, translatedTextRanges);
    activeEditor.setDecorations(parserSyntaxDecorationTypes.nameText, nameRanges);
}

export function clearParserSyntaxDecorations(editor?: vscode.TextEditor) {
    if (!editor) {
        return;
    }

    editor.setDecorations(parserSyntaxDecorationTypes.baseText, []);
    editor.setDecorations(parserSyntaxDecorationTypes.originalPrefix, []);
    editor.setDecorations(parserSyntaxDecorationTypes.originalText, []);
    editor.setDecorations(parserSyntaxDecorationTypes.translatedPrefix, []);
    editor.setDecorations(parserSyntaxDecorationTypes.translatedText, []);
    editor.setDecorations(parserSyntaxDecorationTypes.nameText, []);
}

function shouldApplyParserSyntaxDecorations(editor: vscode.TextEditor): boolean {
    if (editor.document.uri.scheme !== 'file') {
        return false;
    }

    if (editor.document.uri.fsPath.includes('CMakeLists.txt')) {
        return false;
    }

    return editor.document.languageId === 'dltxt'
        || editor.document.languageId === 'formattxt'
        || editor.document.uri.fsPath.endsWith('.txt');
}

function addSegmentRanges(
    document: vscode.TextDocument,
    lineIndex: number,
    groups: MatchedGroups,
    prefixRanges: vscode.Range[],
    textRanges: vscode.Range[],
    excludedSegments: LineSegment[]
) {
    const lineLength = document.lineAt(lineIndex).text.length;
    const prefixLength = Math.min(lineLength, groups.prefix.length + groups.white.length);
    const textStart = prefixLength;
    const textEnd = Math.min(lineLength, textStart + groups.text.length);
    const suffixEnd = Math.min(lineLength, textEnd + groups.suffix.length);

    pushRange(prefixRanges, lineIndex, 0, prefixLength, excludedSegments);
    pushRange(textRanges, lineIndex, textStart, textEnd, excludedSegments);
    pushRange(prefixRanges, lineIndex, textEnd, suffixEnd, excludedSegments);
}

function pushRange(ranges: vscode.Range[], lineIndex: number, start: number, end: number, excludedSegments: LineSegment[] = []) {
    if (end <= start) {
        return;
    }

    let currentStart = start;
    for (const segment of excludedSegments) {
        if (segment.end <= currentStart) {
            continue;
        }

        if (segment.start >= end) {
            break;
        }

        if (segment.start > currentStart) {
            ranges.push(new vscode.Range(lineIndex, currentStart, lineIndex, Math.min(segment.start, end)));
        }

        currentStart = Math.max(currentStart, segment.end);
        if (currentStart >= end) {
            return;
        }
    }

    ranges.push(new vscode.Range(lineIndex, currentStart, lineIndex, end));
}

function buildLineSegmentsByLine(document: vscode.TextDocument, ranges: vscode.Range[]): Map<number, LineSegment[]> {
    const lineSegments = new Map<number, LineSegment[]>();

    for (const range of ranges) {
        for (let lineIndex = range.start.line; lineIndex <= range.end.line; lineIndex++) {
            const lineLength = document.lineAt(lineIndex).text.length;
            const start = lineIndex === range.start.line ? range.start.character : 0;
            const end = lineIndex === range.end.line ? range.end.character : lineLength;
            if (end <= start) {
                continue;
            }

            if (!lineSegments.has(lineIndex)) {
                lineSegments.set(lineIndex, []);
            }

            lineSegments.get(lineIndex)?.push({ start, end });
        }
    }

    for (const segments of lineSegments.values()) {
        segments.sort((a, b) => a.start - b.start);
    }

    return lineSegments;
}

export function updateKeywordDecorations() {

    let activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }

    const dictNames = DictSettings.getAllDictNames();
    for (const dictName of dictNames) {
        const {deco, oldDeco, changed} = DictSettings.getDictDecoration(dictName);
        const namingDecoType = DictSettings.getNamingDecoration(dictName);
        const keywordsDecoSink = new DecorationSink();
        const type = DictSettings.getDictType(dictName);
        const showHighLight = DictSettings.getStyleShow(dictName);
        const decoID = `${activeEditor.document.uri.fsPath}::${dictName}`;
        if (!showHighLight) {
            if (oldDeco) {
                activeEditor.setDecorations(oldDeco, []);
            }
            if (deco) {
                activeEditor.setDecorations(deco, []);
            }
            namingDecoType && activeEditor.setDecorations(namingDecoType, []);
            continue;
        }
        if (changed && oldDeco) {
            activeEditor.setDecorations(oldDeco, []);
        }

        let keywords: DictKeyInfo[] = [];
        let naming: any = {};
        if (type === DictType.Local) {
            keywords = DictSettings.getLocalDictKeys(dictName);
        } else if (type == DictType.RemoteUser || type == DictType.RemoteURL) {
            let game : string | undefined = DictSettings.getGameTitle(dictName);
            if (!game) {
                continue;
            }
            keywords = DictSettings.getSimpleTMDictKeys(dictName, game);
            naming = DictSettings.getSimpleTMNamingRules(dictName, game);
        }
        const testArray: Array<String> = [];
        for (let i = 0; i < keywords.length; i++) {
            let v = keywords[i];
            let vr = String(v.raw);
            if(vr)
                testArray.push(vr);
        }
        if (testArray.length > 0) {
            let dict = new Map<String, string>();
            const comments = new Map<String, string>();
            keywords.forEach(v => {
                dict.set(v.raw, v.translate);
                if (v.comment) {
                    comments.set(v.raw, v.comment);
                }
            });

            const text = activeEditor.document.getText();

            const ac = new AhoCorasick(testArray);
            const results = ac.search(text) as any[];
            for (let res of results) {
                const endIndex = res[0];
                const keywords = res[1];
                for (let keyword of keywords) {
                    const index = endIndex + 1 - keyword.length;
                    const startPos = activeEditor.document.positionAt(index);
                    const endPos = activeEditor.document.positionAt(index + keyword.length);
                    const word = dict.get(keyword)?.replace(/"/g, '') as string;
                    const originalWord = keyword.replace(/"/g, '') as string;
                    const copyCommand = `[copy](command:Extension.dltxt.copyToClipboard?{"text":"${encodeURIComponent(word)}"})`;
                    const replaceCommand = `[replace](command:Extension.dltxt.replaceAllInLine?{"old_text":"${encodeURIComponent(originalWord)}","new_text":"${encodeURIComponent(word)}","line":${startPos.line}})`;
                    const comment = comments.has(originalWord) ? ` 备注：${comments.get(originalWord)}` : '';
                    const hoverMarkdown = new vscode.MarkdownString(`${word} ${copyCommand} ${replaceCommand}${comment}`);
                    hoverMarkdown.isTrusted = true;
                    const decoration = {
                        range: new vscode.Range(startPos, endPos),
                        hoverMessage: hoverMarkdown,
                        renderOptions: {},
                        __dltxt: {
                            old_text: originalWord,
                            new_text: word
                        }
                    };
                    keywordsDecoSink.add(decoration);
                }
            }
            activeEditor.setDecorations(deco, keywordsDecoSink.getAll());
        }
        

        const namingDecoSink = new DecorationSink();
        if (Object.keys(naming).length > 0) {
            const testArrays = new Map<string, string[]>(); // caller -> called[]
            for (const caller in naming) {
                const testArray: string[] = [];
                for(const called in naming[caller]) {
                    testArray.push(called);
                }
                testArrays.set(caller, testArray);
            }
            const allCalleds = new Set<string>();
            for (const caller in naming) {
                for (const called in naming[caller]) {
                    allCalleds.add(called);
                }
            }
            const allCalledArray = Array.from(allCalleds);
            const lineNumberToTalker = new Map<number, string>();
            DocumentParser.processPairedLines(activeEditor.document, (jgrps, cgrps, j_index, c_index, talkingName) => {
                if (talkingName) {
                    lineNumberToTalker.set(j_index, talkingName);
                    lineNumberToTalker.set(c_index, talkingName);
                }
            });
            const calledTranslationResolver = new CalledTranslationResolver(naming, lineNumberToTalker);
            const ac = new AhoCorasick(allCalledArray);
            const results = ac.search(activeEditor.document.getText()) as any[];
            for (const res of results) {
                const endIndex = res[0];
                const keywords = res[1];
                for (const keyword of keywords) {
                    const index = endIndex + 1 - keyword.length;
                    const startPos = activeEditor.document.positionAt(index);
                    const endPos = activeEditor.document.positionAt(index + keyword.length);
                    const resolution = calledTranslationResolver.resolve(keyword, startPos);
                    if (!resolution.trans) {
                        continue;
                    }
                    const called = keyword.replace(/"/g, '') as string;
                    const copyCommand = `[copy](command:Extension.dltxt.copyToClipboard?{"text":"${encodeURIComponent(resolution.trans)}"})`;
                    const replaceCommand = `[replace](command:Extension.dltxt.replaceAllInLine?{"old_text":"${encodeURIComponent(called)}","new_text":"${encodeURIComponent(resolution.trans)}","line":${startPos.line}})`;
                    const fallbackComment = resolution.fallbackComment ? ` (${resolution.fallbackComment})` : '';
                    const ruleComment = resolution.ruleComment ? ` 备注：${resolution.ruleComment}` : '';
                    const hoverMarkdown = new vscode.MarkdownString(`${resolution.trans}${fallbackComment} ${copyCommand} ${replaceCommand}${ruleComment}`);
                    hoverMarkdown.isTrusted = true;
                    const decoration = {
                        range: new vscode.Range(startPos, endPos),
                        hoverMessage: hoverMarkdown,
                        renderOptions: {},
                        __dltxt: {
                            old_text: called,
                            new_text: resolution.trans
                        }
                    }
                    namingDecoSink.add(decoration);
                }
            }
        } 
        
        if (namingDecoType) {
            activeEditor.setDecorations(namingDecoType, namingDecoSink.getAll());
        }

        DecorationMemoryStorage.set(decoID, keywordsDecoSink.getAll().concat(namingDecoSink.getAll()));
    }
    
}


interface NamingResolution {
	trans?: string;
	fallbackComment?: string;
	ruleComment?: string;
}

class CalledTranslationResolver {
	private inversed = new Map<string, Map<string, DictNamingValue>>(); // called -> caller -> rule
	constructor(private naming: DictNamingRule, private lineNumberToTalker: Map<number, string>) {
		for (const caller in naming) {
			for (const called in naming[caller]) {
				if (!this.inversed.has(called)) {
					this.inversed.set(called, new Map<string, string>());
				}
				this.inversed.get(called)?.set(caller, naming[caller][called]);
			}
		}
	}
	resolve(called: string, position: vscode.Position): NamingResolution {
		const talkingName = this.lineNumberToTalker.get(position.line);
		let trans = '';
		let ruleComment = undefined;
		if (talkingName && this.naming[talkingName]?.[called]) {
			const directRule = this.naming[talkingName][called];
			trans = getDictNamingTranslation(directRule).replace(/"/g, '');
			ruleComment = getDictNamingComment(directRule);
		}
		let fallbackComment = undefined;
		if (!trans) {
			const MatchAnyTalker = '*';
			const fallbackRule = this.naming[MatchAnyTalker]?.[called];
			trans = getDictNamingTranslation(fallbackRule).replace(/"/g, '');
			ruleComment = getDictNamingComment(fallbackRule);
		}
		if (!trans) {
			const possibleTrans: string[] = [];
			const callerMap = this.inversed.get(called);
			if (callerMap) {
				for (const [caller, callerRule] of callerMap) {
					const callerTrans = getDictNamingTranslation(callerRule);
					if (callerTrans) {
						possibleTrans.push(`${caller}: ${callerTrans}`);
						if (!trans) {
							trans = callerTrans.replace(/"/g, '') as string;
							ruleComment = getDictNamingComment(callerRule);
						}
					}
				}
			}
			if (possibleTrans.length > 0) {
				fallbackComment = possibleTrans.join(', ');
			}
		}
		return { trans, fallbackComment, ruleComment };
	}
}

class DecorationSink {
    private decorations: vscode.DecorationOptions[] = [];
    private currentLineDecos: vscode.DecorationOptions[] = [];
    private currentLineIdx: number | null = null;
    public constructor() {

    }

    public add(deco: vscode.DecorationOptions) {
        const lineIdx = deco.range.start.line;
        if (this.currentLineIdx === null || this.currentLineIdx === lineIdx) {
            this.currentLineIdx = lineIdx;
            this.currentLineDecos.push(deco);
        } else {
            this.decorations.push(...this.mergeDecos(this.currentLineDecos));
            this.currentLineDecos = [deco];
            this.currentLineIdx = lineIdx;
        }
    }

    private mergeDecos(lineDecos: vscode.DecorationOptions[]): vscode.DecorationOptions[] {
        if (lineDecos.length <= 1) {
            return lineDecos;
        }
        // start character ascending, end character descending
        lineDecos.sort((a, b) => {
            if (a.range.start.character === b.range.start.character) {
                return b.range.end.character - a.range.end.character;
            }
            return a.range.start.character - b.range.start.character;
        });

        const mergedDecos: vscode.DecorationOptions[] = [];
        for (const deco of lineDecos) {
            if (mergedDecos.length === 0) {
                mergedDecos.push(deco);
            } else {
                const lastDeco = mergedDecos[mergedDecos.length - 1];
                if (deco.range.start.character < lastDeco.range.end.character) {
                    if (deco.range.end.character > lastDeco.range.end.character) {
                        mergedDecos.push(deco);
                    }
                    // If the new deco is completely covered by the last merged deco, we can skip it
                } else {
                    mergedDecos.push(deco);
                }
            }
        }
        return mergedDecos;
    }

    public getAll(): vscode.DecorationOptions[] {
        if (this.currentLineDecos.length > 0) {
            this.decorations.push(...this.mergeDecos(this.currentLineDecos));
            this.currentLineDecos = [];
            this.currentLineIdx = null;
        }
        return this.decorations;
    }
}


export function updateNewlineDecorations() {
    const config = vscode.workspace.getConfiguration("dltxt");
    if (!config.get<boolean>('nestedLine.displayTokenAsSymbol')) {
        const nestedLineToken = config.get("nestedLine.token") as string;
        const newLineDecoTuple = DictSettings.getNewlineDecorationType(nestedLineToken);
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            newLineDecoTuple.oldDeco && activeEditor.setDecorations(newLineDecoTuple.oldDeco, []);
        }
        return;
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }
    const newLineDecos: vscode.DecorationOptions[] = [];
    const nestedLineToken = config.get("nestedLine.token") as string;
    const ac = new AhoCorasick([nestedLineToken]);
    const newlineResults = ac.search(activeEditor.document.getText()) as any[];
    for (const r of newlineResults) {
        const endIndex = r[0];
        const keyword = r[1][0];
        const index = endIndex + 1 - keyword.length;
        const startPos = activeEditor.document.positionAt(index);
        const endPos = activeEditor.document.positionAt(index + keyword.length);
        const decoration = {
            range: new vscode.Range(startPos, endPos),
            renderOptions: {
            }
        };
        newLineDecos.push(decoration);
    }
    const newLineDecoTuple = DictSettings.getNewlineDecorationType(nestedLineToken);
    newLineDecoTuple.oldDeco && activeEditor.setDecorations(newLineDecoTuple.oldDeco, []);
    activeEditor.setDecorations(newLineDecoTuple.deco, newLineDecos);
}
