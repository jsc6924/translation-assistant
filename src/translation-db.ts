import * as kuromoji from 'kuromoji';
import * as vscode from 'vscode';
import { mapToObject } from "./utils";
import * as fs from 'fs';
import * as path from 'path';
import FlexSearch, { Index, SearchResults, SearchOptions } from 'flexsearch'
import { StopWordsSet } from './stopwords-jp';
import { registerCommand, showOutputText, downloadFile, unzipFile } from './utils';
import { getRegex, MatchedGroups } from './formatter';
import * as iconv from "iconv-lite";
import { channel } from './dlbuild';


export async function activate(context: vscode.ExtensionContext) {
    if(index.load(context)) {
        vscode.window.showInformationMessage(`已读取翻译数据库`);
    }

    registerCommand(context, "Extension.dltxt.trdb.context.addDoc", async (arg) => {
        await addDocumentPath(context, arg.fsPath, true);
        saveIndex(context);
    }, false);

    registerCommand(context, "Extension.dltxt.trdb.context.addFolder", async (arg) => {
        const folderPath = arg.fsPath;
        if (!fs.statSync(folderPath).isDirectory()){
            vscode.window.showInformationMessage('请选中一个文件夹');
            return;
        }
        const files = fs.readdirSync(folderPath);
        let successCount = 0;
        let totalCount = 0;
        for(const file of files) {
            const filePath = path.join(folderPath, file);
            if (!fs.statSync(filePath).isFile() && !file.endsWith('.txt')) {
                continue;
            }
            totalCount++;
            try {
                const success = await addDocumentPath(context, filePath, false);
                if (success) {
                    successCount++;
                } else {
                    channel.appendLine(`添加失败：${file}`);
                }
            } catch (err) {
                channel.appendLine(`添加失败：${file}`);
            }
        }
        saveIndex(context);
        vscode.window.showInformationMessage(`添加到翻译数据库：共${totalCount}个文件，成功${successCount}个`);
    }, false);

    registerCommand(context, "Extension.dltxt.trdb.context.deleteDoc", async (arg) => {
        if(await deleteDocumentPath(context, arg.fsPath)) {
            const {base} = path.parse(arg.fsPath);
            saveIndex(context);
            vscode.window.showInformationMessage(`已从翻译数据库移除${base}`)
        }
    }, false);

    registerCommand(context, "Extension.dltxt.trdb.context.loadDB", async () => {
        index.load(context);
        vscode.window.showInformationMessage(`已重新加载翻译数据库`);
    }, false);


    registerCommand(context, "Extension.dltxt.trdb.editor.searchWord", async () => {
        let editor = vscode.window.activeTextEditor;
        let text = '';
        if (editor && !editor.selection.isEmpty) {
            text = editor.document.getText(editor.selection);
        }
        let query = await vscode.window.showInputBox({
            prompt: '输入要搜索的内容',
            value: text
        });
        if (!query) {
            return;
        }
        const res = index.search(query, {
            limit: 20
        });
        showSearchResults(context, query, res);
        
    }, true);


    registerCommand(context, "Extension.dltxt.trdb.editor.searchText", async () => {
        let editor = vscode.window.activeTextEditor;
        let text = '';
        if (editor && !editor.selection.isEmpty) {
            text = editor.document.getText(editor.selection);
        }
        let query = await vscode.window.showInputBox({
            prompt: '输入要搜索的内容',
            value: text
        });
        if (!query) {
            return;
        }
        const tokenizer = await Tokenizer.getAsync(context);
        query = tokenizer.tokenize(query);
        const res = index.search(query, {
            limit: 20,
            suggest: true
        });
        showSearchResults(context, query, res);
        
    }, false);

}

function showSearchResults(context: vscode.ExtensionContext, query: string, matchedFiles: string[]) {
    const memoryIndex = createFlexSearchIndex();
    const databasePath = path.join(context.globalStoragePath, 'trdb');
    const rawTextsPath = path.join(databasePath, 'raw');
    const trTextPath   = path.join(databasePath, 'tr');
    let totalRawLines = [''];
    let totalTrLines = [''];
    let lineCount = totalRawLines.length;
    let lastLine: number[] = [];
    let usedFiles: string[] = [];
    function findFileByLineNumber(line: number): string {
        let i = 0;
        while(i < lastLine.length) {
            if (line < lastLine[i]) {
                return usedFiles[i];
            }
            i++;
        }
        return '';
    }
    for(const file of matchedFiles) {
        const rawFilePath = path.join(rawTextsPath, file);
        const rawContent = fs.readFileSync(rawFilePath, { encoding: 'utf8' });
        const rawLines = rawContent.split('\n');;
        const trFilePath = path.join(trTextPath, file);
        const trFileContent = fs.readFileSync(trFilePath, { encoding: 'utf8' });
        const trLines = trFileContent.split('\n');
        if (rawLines.length != trLines.length) {
            console.error(`line number unmatched ${file}`);
            continue;
        }
        for(let i = 0; i < rawLines.length; i++) {
            // 1 pading, no need to index
            if (i > 0 && i < rawLines.length - 1) {
                memoryIndex.add(lineCount, rawLines[i]);
            }
            lineCount++;
            totalRawLines.push(rawLines[i]);
            totalTrLines.push(trLines[i]);
        }
        lastLine.push(lineCount);
        usedFiles.push(file);
        lineCount++;
        totalRawLines.push('');
        totalTrLines.push('');
    }
    const res = memoryIndex.search(query, {
        limit: 20,
        suggest: true
    }) as any as number[];

    const lineNumberSeen = new Set<Number>();
    let k = 1;
    const outputLines = [];
    outputLines.push(`<p>--------------------"${query}"的搜索结果----------------------`);
    for(const i of res) {
        if (lineNumberSeen.has(i)) {
            continue;
        }
        lineNumberSeen.add(i);
        const file = findFileByLineNumber(i);
        outputLines.push(`-----------------------[${k++}]${file}-----------------------`);
        outputLines.push('');
        for(let j = i-1; j <= i+1; j++) {
            if (j > 0 && j < totalTrLines.length) {
                outputLines.push(totalRawLines[j].replace(/\s+/g, ''));
                outputLines.push(totalTrLines[j]);
                outputLines.push('');
            }
        }
    }
    outputLines.push(`----------------------共${k-1}个结果-----------------------`);
    outputLines.push('</p>')
    showOutputText(`"${query}"的搜索结果`, outputLines.join('<br>'));
}

async function addDocumentPath(context: vscode.ExtensionContext, fsPath: string, verbose: boolean) {
    const fBuf = fs.readFileSync(fsPath);
    const config = vscode.workspace.getConfiguration("dltxt");
    const srcEncoding = config.get('trdb.fileEncoding') as string;
    const content = iconv.decode(fBuf, srcEncoding);
    const lines = content.split('\n');
    const documentFilename = path.parse(fsPath).base;
    return addDocumentLines(context, documentFilename, lines, verbose);
}
async function deleteDocumentPath(context: vscode.ExtensionContext, fsPath: string) {
    const documentFilename = path.parse(fsPath).base;
    const config = vscode.workspace.getConfiguration('dltxt');
    let GameTitle: string = config.get("trdb.project") as string;

    if (!GameTitle) {
        vscode.window.showErrorMessage("请在设置中填写项目名后再使用此功能");
        return false;
    }
    const databasePath = path.join(context.globalStoragePath, 'trdb');
    fs.mkdirSync(path.join(databasePath, 'raw', GameTitle), {recursive: true});
    fs.mkdirSync(path.join(databasePath, 'tr', GameTitle), {recursive: true});
    const indexedFilenamePrefix = `${documentFilename}`;
    const files = fs.readdirSync(path.join(databasePath, "raw", GameTitle)).filter((file) => {
        return file.startsWith(indexedFilenamePrefix);
    });
    if (files.length == 0) {
        vscode.window.showErrorMessage(`翻译数据库中未找到${documentFilename}`);
        return false;
    }
    for(const file of files) {
        fs.unlinkSync(path.join(databasePath, 'raw', GameTitle, file));
        fs.unlinkSync(path.join(databasePath, 'tr', GameTitle, file));
        const indexedFilename = `${GameTitle}/${file}`;
        index.remove(indexedFilename);
    }
    return true;
}
async function addDocument(context: vscode.ExtensionContext, document: vscode.TextDocument, verbose: boolean) {
    let lines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        lines.push(document.lineAt(i).text);
    }
    const documentFilename = path.parse(document.fileName).base;
    return addDocumentLines(context, documentFilename, lines, verbose);
}

async function addDocumentLines(context: vscode.ExtensionContext, documentFilename: string
    , documentLines: string[], verbose: boolean) {
    const config = vscode.workspace.getConfiguration('dltxt');
    let GameTitle: string = config.get("trdb.project") as string;

    if (!GameTitle) {
        vscode.window.showErrorMessage("请在设置中填写项目名后再使用此功能");
        return false;
    }
    const [jreg, creg, oreg] = getRegex();
    if (!jreg || !creg) {
        return false;
    }

    //padding 1
    let lines = [''];
    let clines = [''];

    for (let i = 0; i < documentLines.length; i++) {
        const line = documentLines[i].trim();
        const m = jreg.exec(line);
        if (m && m.groups) {
            const g = m.groups as any as MatchedGroups;
            lines.push(g.text);
        } else {
            const m = creg.exec(line);
            if (m && m.groups) {
                const g = m.groups as any as MatchedGroups;
                clines.push(g.text);
            }
        }
    }
    if (lines.length != clines.length) {
        vscode.window.showErrorMessage(`原文与译文行数不一致，无法加入数据库: ${documentFilename}`);
        return false;
    }

    const filterRegStr = config.get('trdb.filteredLine') as string;
    if (filterRegStr) {
        const [fr, tr] = filterLines(lines, clines, filterRegStr);
        lines = fr;
        clines = tr;
    }

    const tokenizer = await Tokenizer.getAsync(context);
    for(let i = 0; i < lines.length; i++) {
        lines[i] = tokenizer.tokenize(lines[i]);
    }

    //padding 1
    lines.push('');
    clines.push('');
    
    const databasePath = path.join(context.globalStoragePath, 'trdb');
    fs.mkdirSync(path.join(databasePath, 'raw', GameTitle), {recursive: true});
    fs.mkdirSync(path.join(databasePath, 'tr', GameTitle), {recursive: true});

    const ChunkSize = 500;
    for(let k = 1; k < lines.length-1; k += ChunkSize) {
        const indexedFilename = `${GameTitle}/${documentFilename}.${k}.txt`;
        const rIndexLines = lines.slice(k-1, k+ChunkSize+1);
        const rawContent = rIndexLines.join('\n');
        index.add(indexedFilename, rawContent);

        const trContent = clines.slice(k-1, k+ChunkSize+1).join('\n');

        fs.writeFileSync(path.join(databasePath, 'raw', indexedFilename), rawContent, { encoding: 'utf8'});
        fs.writeFileSync(path.join(databasePath, 'tr', indexedFilename), trContent, { encoding: 'utf8'});
    }

    if (verbose) {
        vscode.window.showInformationMessage(`${GameTitle}/${documentFilename}添加成功`);
    }
    return true;
}

function filterLines(rawLines: string[], trLines: string[], filterRegStr: string): [string[], string[]] {
    const frlines: string[] = [];
    const ftlines: string[] = [];
    const filterReg = new RegExp(filterRegStr);
    for(let i = 0; i < rawLines.length; i++) {
        if (filterReg.test(rawLines[i])) {
            continue;
        }
        frlines.push(rawLines[i]);
        ftlines.push(trLines[i]);
    }
    return [frlines, ftlines];
}

async function saveIndex(context: vscode.ExtensionContext) {
    index.save(context);
}


interface IndexedDocument {
    id: number;
    tag: string;
    context: string;
}

function createFlexSearchIndex(): Index<IndexedDocument>{
    return FlexSearch.create({
        tokenize: 'forward',
        encode: "icase",
        split: /\s+/,
        async: false,
        resolution: 9,
        threshold: 7,
        depth: 2,
        filter: function (value) {
            return !StopWordsSet.has(value);
        }
    });
}

export class SearchIndex {
    index: Index<IndexedDocument>;
    idToFilename: Map<number, string> = new Map();
    filenameToId: Map<string, number> = new Map();
    nextId: number = 0;
    constructor() {
        this.index = createFlexSearchIndex();
    }

    add(filename: string, content: string): boolean
    {
        if (this.filenameToId.has(filename)) {
            const id = this.filenameToId.get(filename) as number;
            this.index.update(id, content);
            return false;
        }
        const id = this.nextId;
        this.idToFilename.set(id, filename);
        this.filenameToId.set(filename, id);
        this.index.add(id, content);
        this.nextId++;
        return true;
    }

    remove(filename: string): boolean {
        if (!this.filenameToId.has(filename)) {
            return false;
        }
        const id = this.filenameToId.get(filename) as number;
        this.index.remove(id);
        this.idToFilename.delete(id);
        this.filenameToId.delete(filename);
        return true;
    }

    search(query: string, options?: number | SearchOptions | undefined): string[] {
        const res = this.index.search(query, options) as any as number[];
        const r: string[] = [];
        for (let i = 0; i < res.length; i++) {
            const filename = this.idToFilename.get(res[i]);
            if (filename && r.indexOf(filename) == -1) {
                r.push(filename);
            }
        }
        return r;
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

        if (!fs.existsSync(SearchIndexJsonPath) || !fs.existsSync(IndexPath)) {
            return false;
        }

        const jsonString = fs.readFileSync(SearchIndexJsonPath, 'utf8');
        const savedObj: any = JSON.parse(jsonString);

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
    static downloadURL = 'https://github.com/jsc6924/translation-assistant/raw/master/data/dict.zip'
    static tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | undefined;
    static async getAsync(context: vscode.ExtensionContext): Promise<Tokenizer> {
        if (!Tokenizer.tokenizer) {
            const dictPath = path.join(context.globalStoragePath, "dict");
            if (!fs.existsSync(path.join(context.globalStoragePath, "dict", "base.dat.gz"))) {
                channel.show();
                channel.appendLine(`正在从 ${Tokenizer.downloadURL} 下载词典...`);
                const zipFile = await downloadFile(Tokenizer.downloadURL, path.join(context.globalStoragePath, "dict.zip"));
                channel.appendLine(`下载完成，正在解压...`);
                fs.mkdirSync(dictPath, {recursive: true});
                const files = await unzipFile(zipFile, dictPath);
                channel.appendLine(`解压完成`);
                fs.unlinkSync(zipFile);
            }
            return new Promise((resolve, reject) => {
                kuromoji
                    .builder({ dicPath: dictPath })
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

const index = new SearchIndex;
