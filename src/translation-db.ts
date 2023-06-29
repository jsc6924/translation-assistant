import * as kuromoji from 'kuromoji';
import * as vscode from 'vscode';
import { compressFoldersToZip, mapToObject, writeAtomic } from "./utils";
import * as fs from 'fs';
import * as path from 'path';
import FlexSearch, { Index, SearchResults, SearchOptions } from 'flexsearch'
import { StopWordsSet } from './stopwords-jp';
import { registerCommand, showOutputText, downloadFile, unzipFile, getCurrentWorkspaceFolder } from './utils';
import { getRegex, MatchedGroups } from './formatter';
import * as iconv from "iconv-lite";
import { channel } from './dlbuild';
import { dltxt } from './treeview';


export async function activate(context: vscode.ExtensionContext, treeView: dltxt.TRDBTreeView) {
    if(index.load(context, treeView, true)) {
        vscode.window.showInformationMessage(`已读取翻译数据库`);
    }

    registerCommand(context, "Extension.dltxt.trdb.context.addDoc", async (arg) => {
        TRDBCriticalSection(context, async () => {
            index.load(context, treeView);
            await addDocumentPath(context, arg.fsPath);
            treeView.refresh(context);
            saveIndex(context);
            const documentFilename = path.parse(arg.fsPath).base;
            vscode.window.showInformationMessage(`${documentFilename}添加成功`);
        });
    });

    registerCommand(context, "Extension.dltxt.trdb.context.addFolder", async (arg) => {
        TRDBCriticalSection(context, async() => {
            index.load(context, treeView);
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
                    const success = await addDocumentPath(context, filePath);
                    if (success) {
                        successCount++;
                    } else {
                        channel.appendLine(`添加失败：${file}`);
                        channel.show();
                    }
                } catch (err) {
                    channel.appendLine(`添加失败：${file}`);
                    channel.show();
                }
            }
            saveIndex(context);
            treeView.refresh(context);
            vscode.window.showInformationMessage(`添加到翻译数据库：共${totalCount}个文件，成功${successCount}个`);
        });
    });

    registerCommand(context, "Extension.dltxt.trdb.debug.showDB", () => {
        index.show();
    })

    registerCommand(context, "Extension.dltxt.trdb.treeview.deleteDoc", async (arg) => {
        const folder = arg.folder;
        const filename = arg.filename;
        if (await vscode.window.showWarningMessage(`确认要将${folder}/${filename}从翻译数据库中移除吗`,
            "是", "否") != "是") {
            return;
        }
        TRDBCriticalSection(context, async () => {
            index.load(context, treeView);
            if(await deleteDocument(context, folder, filename)) {
                saveIndex(context);
                treeView.refresh(context);
                vscode.window.showInformationMessage(`已从翻译数据库移除${filename}`);
            }
        });
    });

    registerCommand(context, "Extension.dltxt.trdb.treeview.deleteFolder", async (arg) => {
        const folder = arg.folder;
        if (await vscode.window.showWarningMessage(`确认要将${folder}中所有文件从翻译数据库中移除吗`,
            "是", "否") != "是") {
            return;
        }
        TRDBCriticalSection(context, async () => {
            index.load(context, treeView);
            const files = index.virtualDirectory.get(folder);
            if (!files) {
                vscode.window.showErrorMessage(`翻译数据库中找不到项目${folder}`);
                return;
            }
            let successCount = 0;
            for (const file of files.keys()) {
                try {
                    const success = await deleteDocument(context, folder, file);
                    if (success) {
                        successCount++;
                    } else {
                        channel.appendLine(`删除失败：${file}`);
                        channel.show();
                    }
                } catch (err) {
                    channel.appendLine(`删除失败：${file}`);
                    channel.show();
                }
            }
            saveIndex(context);
            treeView.refresh(context);
            vscode.window.showInformationMessage(`已从翻译数据库移除项目${folder}，共删除${successCount}个文件`);
        });
    });

    registerCommand(context, "Extension.dltxt.trdb.treeview.loadDB", async () => {
        index.load(context, treeView, true);
        vscode.window.showInformationMessage(`已重新加载翻译数据库`);
    });

    registerCommand(context, "Extension.dltxt.trdb.treeview.unlock", async () => {
        if (await vscode.window.showWarningMessage(`本操作将强制清除数据库同步锁，请确保当前翻译数据库没有任务正在执行。是否继续？`,
            "是", "否") != "是") {
            return;
        }
        unlockTRDBIndex(context, true);
        vscode.window.showInformationMessage(`已强制清除同步锁`);
    });

    registerCommand(context, "Extension.dltxt.trdb.treeview.export", async () => {
        const saveOptions: vscode.SaveDialogOptions = {
            title: '导出翻译数据库',
            defaultUri: vscode.Uri.file('dltxt-trdb.zip'),
            filters: {
              'Zip Files': ['zip']
            }
          };
        
        const saveUri = await vscode.window.showSaveDialog(saveOptions);
        if(!saveUri) {
            return;
        }
        TRDBCriticalSection(context, async () => {
            const fsPath = saveUri.fsPath;
            const searchIndexPath = path.join(context.globalStoragePath, "SearchIndex");
            const trdbPath = path.join(context.globalStoragePath, "trdb");
            vscode.window.showInformationMessage('正在导出，请耐心等待...');
            await compressFoldersToZip([searchIndexPath, trdbPath], fsPath);
            vscode.window.showInformationMessage(`已成功导出至${fsPath}`);
        });
    });

    registerCommand(context, "Extension.dltxt.trdb.treeview.import", async () => {
    });


    registerCommand(context, "Extension.dltxt.trdb.editor.searchWord", async () => {
        let editor = vscode.window.activeTextEditor;
        let text = '';
        if (editor && !editor.selection.isEmpty) {
            text = editor.document.getText(editor.selection);
        }
        index.load(context, treeView);
        let query = await vscode.window.showInputBox({
            prompt: '输入要搜索的内容',
            value: text
        });
        if (!query) {
            return;
        }
        const res = index.search(query, {
            limit: 50
        });
        showSearchResults(context, query, res);
        
    }, true);


    registerCommand(context, "Extension.dltxt.trdb.editor.searchText", async () => {
        let editor = vscode.window.activeTextEditor;
        let text = '';
        if (editor && !editor.selection.isEmpty) {
            text = editor.document.getText(editor.selection);
        }
        index.load(context, treeView);
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
            limit: 50,
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
        limit: 50,
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

async function addDocumentPath(context: vscode.ExtensionContext, fsPath: string) {
    const fBuf = fs.readFileSync(fsPath);
    const config = vscode.workspace.getConfiguration("dltxt");
    const srcEncoding = config.get('trdb.fileEncoding') as string;
    const content = iconv.decode(fBuf, srcEncoding);
    const lines = content.split('\n');
    const documentFilename = path.parse(fsPath).base;
    return addDocumentLines(context, documentFilename, lines);
}
async function deleteDocument(context: vscode.ExtensionContext, folder: string, documentFilename: string) {
    const databasePath = path.join(context.globalStoragePath, 'trdb');
    fs.mkdirSync(path.join(databasePath, 'raw', folder), {recursive: true});
    fs.mkdirSync(path.join(databasePath, 'tr', folder), {recursive: true});
    const indexedFilenamePrefix = `${documentFilename}`;
    const files = fs.readdirSync(path.join(databasePath, "raw", folder)).filter((file) => {
        return file.startsWith(indexedFilenamePrefix);
    });
    if (files.length == 0) {
        vscode.window.showErrorMessage(`翻译数据库中未找到${documentFilename}`);
        return false;
    }
    for(const file of files) {
        fs.unlinkSync(path.join(databasePath, 'raw', folder, file));
        fs.unlinkSync(path.join(databasePath, 'tr', folder, file));
        const indexedFilename = `${folder}/${file}`;
        index.remove(indexedFilename);
    }
    return true;
}
async function addDocument(context: vscode.ExtensionContext, document: vscode.TextDocument) {
    let lines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        lines.push(document.lineAt(i).text);
    }
    const documentFilename = path.parse(document.fileName).base;
    return addDocumentLines(context, documentFilename, lines);
}

async function addDocumentLines(context: vscode.ExtensionContext, documentFilename: string
    , documentLines: string[]) {
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

export function lockTRDBIndex(context: vscode.ExtensionContext): boolean {
    const lockFilePath = path.join(context.globalStoragePath, "trdb-lock.json")
    const writeObj = { workspace: getCurrentWorkspaceFolder() }
    try {
        // Attempt to create the lock file exclusively
        const file = fs.openSync(lockFilePath, 'wx');
        fs.writeFileSync(file, JSON.stringify(writeObj));
        fs.closeSync(file);
        // If the lock file is successfully created, no other process has acquired the lock
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          // Another process already acquired the lock
          return false;
        } else {
          // Handle any other error that occurred during lock acquisition
          channel.appendLine(`Error acquiring lock: ${error}`);
          channel.show();
          return false;
        }
      }
}

export function unlockTRDBIndex(context: vscode.ExtensionContext, forced: boolean = false) {
    const lockFilePath = path.join(context.globalStoragePath, "trdb-lock.json")
    try {
        fs.unlinkSync(lockFilePath);
    } catch (error) {
        if (!forced) {
            channel.appendLine(`Error releasing lock: ${error}`);
            channel.show();
        }
    }
}


export async function TRDBCriticalSection(context: vscode.ExtensionContext, callback: () => any): Promise<any> {
    if (!lockTRDBIndex(context)) {
        vscode.window.showErrorMessage(`数据库正忙，请稍后再试。如果可以确定数据库当前没有任务在运行，可尝试手动清除同步锁`);
        return undefined;
    }
    try {
        const res = await callback();
        unlockTRDBIndex(context);
        return res;
    } catch (error) {
        unlockTRDBIndex(context);
        channel.appendLine(`uncatched error in critical section: ${error}`);
        channel.show();
    }
    return undefined;
}

export class SearchIndex {
    index: Index<IndexedDocument>;
    idToFilename: Map<number, string> = new Map();
    filenameToId: Map<string, number> = new Map();
    virtualDirectory: Map<string, Set<string>> = new Map();
    nextId: number = 0;
    version: number = -1;
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
        this.virtualDirectoryAdd(filename);
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
        this.virtualDirectoryRemove(filename);
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
        this.version++;
        let savedObj: any = {};
        const SearchIndexPath = path.join(context.globalStoragePath, 'SearchIndex');
        fs.mkdirSync(SearchIndexPath, { recursive: true });

        const indexContent = this.index.export()
        const indexPath = path.join(SearchIndexPath, 'Index.json');

        savedObj['idToFilename'] = mapToObject(this.idToFilename);
        savedObj['filenameToId'] = mapToObject(this.filenameToId);
        savedObj['nextId'] = this.nextId;
        savedObj['version'] = this.version;
        const jsonString = JSON.stringify(savedObj);
        const savePath = path.join(SearchIndexPath, 'SearchIndex.json');

        writeAtomic(indexPath, indexContent);
        writeAtomic(savePath, jsonString);
    }

    load(context: vscode.ExtensionContext, treeview: dltxt.TRDBTreeView, forced: boolean = false): boolean {
        const SearchIndexPath = path.join(context.globalStoragePath, 'SearchIndex');
        const SearchIndexJsonPath = path.join(SearchIndexPath, 'SearchIndex.json');
        const IndexPath = path.join(SearchIndexPath, 'Index.json');

        if (!fs.existsSync(SearchIndexJsonPath) || !fs.existsSync(IndexPath)) {
            return false;
        }

        const jsonString = fs.readFileSync(SearchIndexJsonPath, 'utf8');
        const savedObj: any = JSON.parse(jsonString);

        let savedVersion = savedObj['version'] as number;
        if (savedVersion == undefined) {
            savedVersion = 0;
        }
        if (this.version >= savedVersion && !forced) {
            return true;
        }

        this.version = savedVersion;
        this.nextId = savedObj['nextId'] as number;
        this.idToFilename.clear();
        this.filenameToId.clear();
        Object.entries(savedObj['idToFilename']).forEach(([key, value]) => {
            this.idToFilename.set(Number(key), String(value));
        });
        Object.entries(savedObj['filenameToId']).forEach(([key, value]) => {
            this.filenameToId.set(String(key), Number(value));
        });

        this.refreshVirtualDirectory();
        treeview.refresh(context);

        const IndexContent = fs.readFileSync(IndexPath, 'utf8');
        this.index.import(IndexContent);
        return true;
    }

    filenamePattern = /(.*)\/(.*)(\.\d+\.txt)/;

    parseFilename(file: string): [string, string] {
        const m = this.filenamePattern.exec(file);
        if (!m) {
            throw new Error(`error parsing filename ${file}`)
        }
        const folder = m[1];
        const filename = m[2];
        return [folder, filename];
    }

    refreshVirtualDirectory() {
        this.virtualDirectory = new Map();
        for(const file of this.filenameToId.keys()) {
            this.virtualDirectoryAdd(file);
        }
    }

    virtualDirectoryAdd(file: string) {
        const [folder, filename] = this.parseFilename(file);
        if (this.virtualDirectory.has(folder)) {
            this.virtualDirectory.get(folder)?.add(filename);
        } else {
            this.virtualDirectory.set(folder, new Set([filename]));
        }
    }

    virtualDirectoryRemove(file: string) {
        const [folder, filename] = this.parseFilename(file);
        if (this.virtualDirectory.has(folder)) {
            let files = this.virtualDirectory.get(folder);
            if (!files) {
                return;
            }
            files.delete(filename);
            if (files.size == 0) {
                this.virtualDirectory.delete(folder);
            } else {
                this.virtualDirectory.set(folder, files);
            }
        }
    }

    show() {
        channel.appendLine(`-------------trdb------------`);
        channel.appendLine(`version: ${this.version}`);
        channel.appendLine(`nextId: ${this.nextId}`);
        channel.appendLine(`${this.filenameToId.size} files`);
        // for(const file of this.filenameToId.keys()) {
        //     channel.appendLine(file);
        // }
        channel.appendLine(`-----------------------------`);
        channel.show();
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

export const TRDBIndex = new SearchIndex;
const index = TRDBIndex;
