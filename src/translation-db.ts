import * as kuromoji from 'kuromoji';
import * as vscode from 'vscode';
import { mapToObject } from "./utils";
import * as fs from 'fs';
import * as path from 'path';
import FlexSearch, { Index, SearchResults, SearchOptions } from 'flexsearch'
import { StopWordsSet } from './stopwords-jp';
import { registerCommand } from './utils';
import { getRegex, MatchedGroups } from './formatter';


export async function activate(context: vscode.ExtensionContext) {
    index.load(context);
    
    registerCommand(context, "Extension.dltxt.trdb.addDocument", async () => {
        const editor = vscode.window.activeTextEditor;
        const [jreg, creg, oreg] = getRegex();
        if (!editor || !jreg || !creg) {
            return;
        }

        const document = vscode.window.activeTextEditor?.document;
        if (!document) return;

        const config = vscode.workspace.getConfiguration('dltxt');
        let GameTitle: string = config.get("simpleTM.project") as string;
		if (!GameTitle) {
			vscode.window.showErrorMessage("请在设置中填写项目名后再使用此功能");
			return;
		}

        const tokenizer = await Tokenizer.getAsync();
        const lines = [];
        const clines = [];
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            const m = jreg.exec(line) as any as MatchedGroups;
            if (m) {
                lines.push(tokenizer.tokenize(m.text));
            } else {
                const m = creg.exec(line) as any as MatchedGroups;
                if (m) {
                    clines.push(m.text);
                }
            }
        }
        if (lines.length != clines.length) {
            vscode.window.showErrorMessage('原文与译文行数不一致，无法加入数据库');
            return;
        }
        const rawContent = lines.join('\n');
        const trContent = clines.join('\n');
        const rawFileName = `${GameTitle}-${document.fileName}-j.txt`;
        const trFileName = `${GameTitle}-${document.fileName}-c.txt`
        const databasePath = path.join(context.globalStoragePath, 'trdb');
        const rawTextsPath = path.join(databasePath, 'raw');
        const trTextPath   = path.join(databasePath, 'tr');
        fs.mkdirSync(rawTextsPath, {recursive: true});
        fs.mkdirSync(trTextPath, {recursive: true});

        index.add(rawFileName, rawContent);
        fs.writeFileSync(path.join(rawTextsPath, rawFileName), rawContent, { encoding: 'utf8'});
        fs.writeFileSync(path.join(trTextPath, trFileName), trContent, { encoding: 'utf8'});
    })
}


interface IndexedDocument {
    id: number;
    tag: string;
    context: string;
}

export class SearchIndex {
    index: Index<IndexedDocument>;
    idToFilename: Map<number, string> = new Map();
    filenameToId: Map<string, number> = new Map();
    nextId: number = 0;
    constructor() {
        this.index = FlexSearch.create({
            tokenize: 'forward',
            split: /\s+/,
            async: false,
            filter: function (value) {
                return !StopWordsSet.has(value);
            }
        });
    }

    add(filename: string, content: string) {
        const id = this.nextId;
        this.idToFilename.set(id, filename);
        this.filenameToId.set(filename, id);
        this.index.add(id, content);
        this.nextId++;
    }

    save(context: vscode.ExtensionContext) {
        let savedObj: any = {};
        const SearchIndexPath = path.join(context.globalStoragePath, 'SearchIndex');
        fs.mkdirSync(SearchIndexPath, { recursive: true });

        const indexContent = this.index.export()
        const IndexPath = path.join(SearchIndexPath, 'Index.json');
        fs.writeFileSync(IndexPath, indexContent, { encoding: 'utf8' });

        savedObj['idToFilename'] = mapToObject(this.idToFilename);
        savedObj['filenameToId'] = mapToObject(this.filenameToId);
        savedObj['nextId'] = this.nextId;
        const jsonString = JSON.stringify(savedObj);
        const savePath = path.join(SearchIndexPath, 'SearchIndex.json');
        fs.writeFileSync(savePath, jsonString, { encoding: 'utf8' });

    }

    load(context: vscode.ExtensionContext): boolean {
        const SearchIndexPath = path.join(context.globalStoragePath, 'SearchIndex');
        const SearchIndexJsonPath = path.join(SearchIndexPath, 'SearchIndex.json');
        const IndexPath = path.join(SearchIndexPath, 'Index.json');
        const jsonString = fs.readFileSync(SearchIndexJsonPath, 'utf8');
        const savedObj: any = JSON.parse(jsonString);

        if (!fs.existsSync(SearchIndexJsonPath) || !fs.existsSync(IndexPath)) {
            return false;
        }

        this.nextId = savedObj['nextId'] as number;
        Object.entries(savedObj['idToFilename']).forEach(([key, value]) => {
            this.idToFilename.set(Number(key), String(value));
        });
        Object.entries(savedObj['filenameToId']).forEach(([key, value]) => {
            this.filenameToId.set(String(key), Number(value));
        });

        const IndexContent = fs.readFileSync(IndexPath, 'utf8');
        this.index.import(IndexContent);
        return true;
    }
}

export class Tokenizer {
    static tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | undefined;
    static getAsync(): Promise<Tokenizer> {
        if (!Tokenizer.tokenizer) {
            return new Promise((resolve, reject) => {
                kuromoji
                    .builder({ dicPath: 'C://Users//jsc//source//repos//translation-assistant//data//dict' })
                    .build((err, tokenizer) => {
                        if (err) {
                            console.error('Kuromoji initialization error:', err);
                            reject(err);
                            return;
                        }
                        Tokenizer.tokenizer = tokenizer;
                        resolve(new Tokenizer());
                    })
            })

        } else {
            return Promise.resolve(new Tokenizer);
        }
    }

    tokenize(text: string): string {
        if (!Tokenizer.tokenizer) {
            return '';
        }
        return Tokenizer.tokenizer.tokenize(text).map((token) => token.surface_form).join(' ');
    }
}

async function testSave(context: vscode.ExtensionContext) {
    const index = new SearchIndex();

    // Example Japanese text
    const japaneseText = '日本語を話すのが好きなのはあなたらしい。';
    // // Tokenize the Japanese text using Kuromoji
    const tokenizer = await Tokenizer.getAsync()
    const tokenizedText = tokenizer.tokenize(japaneseText);

    // Add the tokenized text to the FlexSearch index
    index.add('my-doc-1', tokenizedText);

    // Perform a search
    const query = '話す';
    const results = index.index.search(query);

    console.log('Search results:', results);
    index.save(context);
}

async function testLoad(context: vscode.ExtensionContext) {
    const index = new SearchIndex();
    index.load(context);
    // Perform a search
    const query = '日本語';
    const results = index.index.search(query);

    const query2 = 'を';
    const results2 = index.index.search(query2);

    console.log('Search results:', results);
    console.log('Search results2:', results2);

    const query3 = '日本語を喋るのが好きなのはあなたらしくない。';
    const tokenizer = await Tokenizer.getAsync();
    const tokenizedQuery3 = tokenizer.tokenize(query3);
    const results3 = index.index.search(tokenizedQuery3, {
        suggest: true
    });
    console.log('Search results3:', results3);

    const query4 = 'らし';
    const results4 = index.index.search(query4);

    console.log('Search results4:', results4);
}


const index = new SearchIndex;
