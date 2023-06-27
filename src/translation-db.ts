import * as kuromoji from 'kuromoji';
import * as vscode from 'vscode';
import { mapToObject } from "./utils";
import * as fs from 'fs';
import * as path from 'path';
import FlexSearch, { Index, SearchResults, SearchOptions } from 'flexsearch'

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
            tokenize: 'strict',
            split: /\s+/,
            async: false
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

export function activate(context: vscode.ExtensionContext) {
    testLoad(context);
    //testSave(context);
}

export class Tokenizer {
    static tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | undefined;
    static getAsync(): Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> {
        if (!this.tokenizer) {
            return new Promise((resolve, reject) => {
                kuromoji
                .builder({ dicPath: 'C://Users//jsc//source//repos//translation-assistant//data//dict'})
                .build((err, tokenizer) => {
                    if (err) {
                        console.error('Kuromoji initialization error:', err);
                        reject(err);
                        return;
                    }
                    this.tokenizer = tokenizer;
                    resolve(tokenizer);
                })
            })
            
        } else {
            return Promise.resolve(this.tokenizer);
        }
    }
}

async function testSave(context: vscode.ExtensionContext) {
    const index = new SearchIndex();

    // Example Japanese text
    const japaneseText = '日本語のテキストです。';
    // // Tokenize the Japanese text using Kuromoji
    const tokenizer = await Tokenizer.getAsync()
    const tokens = tokenizer.tokenize(japaneseText);
    const tokenizedText = tokens.map((token) => token.surface_form).join(' ');

    // Add the tokenized text to the FlexSearch index
    index.add('my-doc-1', tokenizedText);

    // Perform a search
    const query = 'テキスト';
    const results = index.index.search(query);

    console.log('Search results:', results);
    index.save(context);
}

function testLoad(context: vscode.ExtensionContext) {
    const index = new SearchIndex();
    index.load(context);
    // Perform a search
    const query = 'テキスト';
    const results = index.index.search(query);

    const query2 = 'aa';
    const results2 = index.index.search(query2);

    console.log('Search results:', results);
    console.log('Search results2:', results2);
}