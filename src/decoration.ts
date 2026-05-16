import * as vscode from 'vscode';
import { DictSettings, DictKeyInfo, DictType, DictNamingRule, DictNamingValue, getDictNamingComment, getDictNamingTranslation } from './utils';
const AhoCorasick = require('ahocorasick');
import { DecorationMemoryStorage } from './simpletm';
import { DocumentParser } from './parser';

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
