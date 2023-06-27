import * as kuromoji from 'kuromoji';
import * as vscode from 'vscode';
import { mapToObject } from "./utils";
import * as fs from 'fs';
import * as path from 'path';
import FlexSearch, { Index, SearchResults, SearchOptions } from 'flexsearch'
import { StopWordsSet } from './stopwords-jp';

interface IndexedDocument {
    id: number;
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
            filter: function(value){
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

    save(context: vscode.ExtensionContext){
        let savedObj: any = {};
        const SearchIndexPath = path.join(context.globalStoragePath, 'SearchIndex');
        fs.mkdirSync(SearchIndexPath, {recursive: true});

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

    load(context: vscode.ExtensionContext) {
        const SearchIndexPath = path.join(context.globalStoragePath, 'SearchIndex');
        const savePath = path.join(SearchIndexPath, 'SearchIndex.json');
        const jsonString = fs.readFileSync(savePath, 'utf8');
        const savedObj: any = JSON.parse(jsonString);

        this.nextId = savedObj['nextId'] as number;
        Object.entries(savedObj['idToFilename']).forEach(([key, value]) => {
            this.idToFilename.set(Number(key), String(value));
        });
        Object.entries(savedObj['filenameToId']).forEach(([key, value]) => {
            this.filenameToId.set(String(key), Number(value));
        });
        const IndexPath = path.join(SearchIndexPath, 'Index.json');
        const IndexContent = fs.readFileSync(IndexPath, 'utf8');
        this.index.import(IndexContent);
    }
}

export async function activate(context: vscode.ExtensionContext) {
    await testSave(context);
    await testLoad(context);
}

export class Tokenizer {
    static tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | undefined;
    static getAsync(): Promise<Tokenizer> {
        if (!Tokenizer.tokenizer) {
            return new Promise((resolve, reject) => {
                kuromoji
                .builder({ dicPath: 'C://Users//jsc//source//repos//translation-assistant//data//dict'})
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