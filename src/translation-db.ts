import * as kuromoji from 'kuromoji';
import * as vscode from 'vscode';
import { compressFoldersToZip, getWebviewContent, mapToObject, writeAtomic } from "./utils";
import * as fs from 'fs';
import * as path from 'path';
import FlexSearch, { Index, SearchResults, SearchOptions } from 'flexsearch'
import { StopWordsSet } from './stopwords-jp';
import { registerCommand, downloadFile, unzipFile, getCurrentWorkspaceFolder } from './utils';
import * as iconv from "iconv-lite";
import { channel } from './dlbuild';
import { trdb_view } from './treeview';
import { DocumentParser } from './parser';
import { Semaphore } from 'async-mutex';
const fsextra = require('fs-extra');


export async function activate(context: vscode.ExtensionContext, treeView: trdb_view.TRDBTreeView) {
    index.bind(treeView);
    index.load(context, true);

    registerCommand(context, "Extension.dltxt.trdb.context.addDoc", async (arg) => {
        TRDBCriticalSection(context, async () => {
            index.load(context);
            try {
                await addDocumentPath(context, arg.fsPath)
                treeView.refresh(context);
                saveIndex(context); 
                const documentFilename = path.parse(arg.fsPath).base;
                vscode.window.showInformationMessage(`${documentFilename}添加成功`);
            } catch (err) {
                vscode.window.showErrorMessage(`添加失败: ${err}`);
            }
            
        });
    });

    registerCommand(context, "Extension.dltxt.trdb.context.addFolder", async (arg) => {
        TRDBCriticalSection(context, async() => {
            index.load(context);
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
                if (!fs.statSync(filePath).isFile() && !file.toLocaleLowerCase().endsWith('.txt')) {
                    continue;
                }
                totalCount++;
                try {
                    await addDocumentPath(context, filePath);
                    successCount++;
                } catch (err) {
                    channel.appendLine(`添加失败：${file} ${err}`);
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
            index.load(context);
            if(deleteDocument(context, folder, filename)) {
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
            index.load(context);
            const files = index.virtualDirectory.get(folder);
            if (!files) {
                vscode.window.showErrorMessage(`翻译数据库中找不到项目${folder}`);
                return;
            }
            let successCount = 0;
            for (const file of files.keys()) {
                try {
                    const success = deleteDocument(context, folder, file);
                    if (success) {
                        successCount++;
                    } else {
                        channel.appendLine(`删除失败：${file}`);
                        channel.show();
                    }
                } catch (err) {
                    channel.appendLine(`删除失败：${file}, ${err}`);
                    channel.show();
                }
            }
            saveIndex(context);
            treeView.refresh(context);
            vscode.window.showInformationMessage(`已从翻译数据库移除项目${folder}，共删除${successCount}个文件`);
        });
    });

    registerCommand(context, "Extension.dltxt.trdb.treeview.loadDB", async () => {
        index.load(context, true);
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
            const searchIndexPath = path.join(context.globalStorageUri.fsPath, "SearchIndex");
            const trdbPath = path.join(context.globalStorageUri.fsPath, "trdb");
            channel.appendLine('------导出数据库-----');
            vscode.window.showInformationMessage('正在导出，请耐心等待...');
            await compressFoldersToZip([searchIndexPath, trdbPath], fsPath);
            vscode.window.showInformationMessage(`已成功导出至${fsPath}`);
        });
    });

    registerCommand(context, "Extension.dltxt.trdb.treeview.import", async () => {
        const ImportOptions = [
            '与现有数据库合并（文件名冲突时用新文件覆盖）',
            '与现有数据库合并（文件名冲突时保留旧文件）',
            '替换现有数据库'
        ]
        const method = await vscode.window.showQuickPick(ImportOptions, {
            placeHolder: '请选择导入方式',
        })
        if (!method) {
            return;
        }

        const options: vscode.OpenDialogOptions = {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
              'ZIP Files': ['zip'],
              'All Files': ['*']
            }
          };

        if (method === ImportOptions[0] || method === ImportOptions[1]) {
            const fileUris = await vscode.window.showOpenDialog(options);
            if (fileUris && fileUris.length > 0) {
                const replaceOnConflict = method === ImportOptions[0];
                TRDBCriticalSection(context, async () => {
                    const filePath = fileUris[0].fsPath;
                    const tempPath = path.join(context.globalStorageUri.fsPath, "trdb-import-temp");
                    channel.show();
                    channel.appendLine('------导入数据库-----');
                    channel.appendLine('正在解压...');
                    await unzipFile(filePath, tempPath);
                    channel.appendLine('正在导入新数据库...');
                    const tempSearchIndexPath = path.join(tempPath, "SearchIndex");
                    const tempTrdbPath = path.join(tempPath, "trdb");
                    const tempSearchIndex = new SearchIndex();
                    tempSearchIndex.load(context, true, tempSearchIndexPath);
                    tempSearchIndex.listFiles((folder, files) => {
                        channel.appendLine(`正在导入文件夹 ${folder} 中的 ${files.length} 个文件`);
                        for(const file of files) {
                            importDocument(context, tempTrdbPath, folder, file, replaceOnConflict);
                        }
                    });
                    fsextra.removeSync(tempPath);
                    treeView.refresh(context);
                    index.save(context); //save as oldVersion + 1
                    channel.appendLine('导入成功');
                });
            }
        } else if (method === ImportOptions[2]) {//replace
            const fileUris = await vscode.window.showOpenDialog(options);
            if (fileUris && fileUris.length > 0) {
                TRDBCriticalSection(context, async () => {
                    const filePath = fileUris[0].fsPath;
                    const tempPath = path.join(context.globalStorageUri.fsPath, "trdb-import-temp");
                    channel.show();
                    channel.appendLine('------导入数据库-----');
                    channel.appendLine('正在解压...');
                    await unzipFile(filePath, tempPath);
                    channel.appendLine('正在删除原数据库...');
                    const searchIndexPath = path.join(context.globalStorageUri.fsPath, "SearchIndex");
                    const trdbPath = path.join(context.globalStorageUri.fsPath, "trdb");
                    fsextra.removeSync(searchIndexPath);
                    fsextra.removeSync(trdbPath);
                    channel.appendLine('正在导入新数据库...');
                    const tempSearchIndexPath = path.join(tempPath, "SearchIndex");
                    const tempTrdbPath = path.join(tempPath, "trdb");
                    fsextra.moveSync(tempSearchIndexPath, searchIndexPath);
                    fsextra.moveSync(tempTrdbPath, trdbPath);
                    fsextra.removeSync(tempPath);
                    const oldVersion = index.version;
                    index.load(context, true);
                    if (index.version < oldVersion) {
                        index.version = oldVersion;
                    }
                    index.save(context); //save as oldVersion + 1
                    channel.appendLine('导入成功');
                });
            }
        } 
    });


    registerCommand(context, "Extension.dltxt.trdb.editor.searchWord", async () => {
        let editor = vscode.window.activeTextEditor;
        let text = '';
        if (editor && !editor.selection.isEmpty) {
            text = editor.document.getText(editor.selection);
        }
        index.load(context);
        let query = await vscode.window.showInputBox({
            prompt: '输入要搜索的内容',
            value: text
        });
        if (!query) {
            return;
        }
        const config = vscode.workspace.getConfiguration("dltxt.trdb");
        const limit = config.get("search.resultLimit") as number;
        const res = index.search(query, {
            limit: limit
        });
        showSearchResults(context, query, res);
        
    }, true);


    registerCommand(context, "Extension.dltxt.trdb.editor.searchText", async () => {
        let editor = vscode.window.activeTextEditor;
        let text = '';
        if (editor && !editor.selection.isEmpty) {
            text = editor.document.getText(editor.selection);
        }
        index.load(context);
        let query = await vscode.window.showInputBox({
            prompt: '输入要搜索的内容',
            value: text
        });
        if (!query) {
            return;
        }
        const tokenizer = await Tokenizer.getAsync(context);
        query = tokenizer.tokenize(query);
        const config = vscode.workspace.getConfiguration("dltxt.trdb");
        const limit = config.get("search.resultLimit") as number;
        const res = index.search(query, {
            limit: limit,
            suggest: true
        });
        showSearchResults(context, query, res);
        
    }, false);

}

interface SearchResult {
    query: string;
    results: SingleResult[];
}

interface SingleResult {
    id: number;
    fileName: string;
    jpLines: string[];
    trLines: string[];
}

function showSearchResults(context: vscode.ExtensionContext, query: string, matchedFiles: string[]) {
    const memoryIndex = createFlexSearchIndex();
    const databasePath = path.join(context.globalStorageUri.fsPath, 'trdb');
    const rawTextsPath = path.join(databasePath, 'raw');
    const trTextPath   = path.join(databasePath, 'tr');
    let totalRawLines = [''];
    let totalTrLines = [''];
    let lineCount = totalRawLines.length;
    let lastLine: number[] = [];
    let usedFiles: string[] = [];
    function findFileByLineNumber(line: number): [string, number] {
        let i = 0;
        while(i < lastLine.length) {
            if (line < lastLine[i]) {
                return [usedFiles[i], i == 0 ? 1 : lastLine[i-1] + 1]; //+1 padding
            }
            i++;
        }
        return ['', -1];
    }
    for(const file of matchedFiles) {
        const rawFilePath = path.join(rawTextsPath, file);
        const rawContent = fs.readFileSync(rawFilePath, { encoding: 'utf8' });
        const rawLines = rawContent.split('\n');
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
    const config = vscode.workspace.getConfiguration("dltxt.trdb");
    const limit = config.get("search.resultLimit") as number;
    const res = memoryIndex.search(query, {
        limit: limit,
        suggest: true
    }) as any as number[];

    const lineNumberSeen = new Set<Number>();
    let k = 1;
    const result : SearchResult =  { 
        query: query,
        results: []
    };
    for(const i of res) {
        if (lineNumberSeen.has(i)) {
            continue;
        }
        lineNumberSeen.add(i);
        const [file, offset] = findFileByLineNumber(i);
        const filenamePattern = /(.*)\/(.*)\.(\d+)(\.txt)/;
        const m = filenamePattern.exec(file)
        let fileLineStart = 0;
        let virtualFileName = file;
        if (m) {
            fileLineStart = Number(m[3]) - 1;
            virtualFileName = m[1] + '/' + m[2];
        }
        const singleResult: SingleResult = { 
            id: k++,
            fileName: virtualFileName,
            jpLines: [],
            trLines: []
        }
        for(let j = i-1; j <= i+1; j++) {
            if (j > 0 && j < totalTrLines.length) {
                let docLine = fileLineStart + j - offset;
                const tag = `${docLine.toString().padStart(6, '0')}`;
                singleResult.jpLines.push(`[${tag}]` + totalRawLines[j].replace(/\s+/g, ''));
                singleResult.trLines.push(`;[${tag}]` + totalTrLines[j]);
            }
        }
        result.results.push(singleResult)
    }
    showSearchResultWebView(context, `"${query}"的搜索结果`, result);
}

function showSearchResultWebView(context: vscode.ExtensionContext, title:string, result: SearchResult) {
    let jsonData = JSON.stringify(result);
    // Create or reveal the Webview panel
    const panel = vscode.window.createWebviewPanel(
        'trdb-search-result-viewer',
        title,
        vscode.ViewColumn.One,
        {
            // Enable scripts in the webview
            enableScripts: true
        }
    );

    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'trdb-viewer.js'));
    const cssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'trdb-viewer.css'));

    // Set the HTML content
    panel.webview.html = getWebviewContent(scriptUri, cssUri, jsonData);
    panel.reveal();
  }

async function addDocumentPath(context: vscode.ExtensionContext, fsPath: string) {
    const fBuf = fs.readFileSync(fsPath);
    const config = vscode.workspace.getConfiguration("dltxt");
    const srcEncoding = config.get('trdb.fileEncoding') as string;
    const content = iconv.decode(fBuf, srcEncoding);
    const documentFilename = path.parse(fsPath).base;
    return addDocument(context, documentFilename, content);
}
export function findBlocksForVirtualDocument(context: vscode.ExtensionContext, 
    folder: string, documentFilename: string): string[] 
{
    const databasePath = path.join(context.globalStorageUri.fsPath, 'trdb');
    fs.mkdirSync(path.join(databasePath, 'raw', folder), {recursive: true});
    fs.mkdirSync(path.join(databasePath, 'tr', folder), {recursive: true});
    const indexedFilenamePrefix = `${documentFilename}`;
    const files = fs.readdirSync(path.join(databasePath, "raw", folder)).filter((file) => {
        return file.startsWith(indexedFilenamePrefix);
    });
    if (files.length == 0) {
        throw new Error(`翻译数据库中未找到${documentFilename}`)
    }
    return files;
}
function deleteDocument(context: vscode.ExtensionContext, folder: string, documentFilename: string) {
    const databasePath = path.join(context.globalStorageUri.fsPath, 'trdb');
    const files = findBlocksForVirtualDocument(context, folder, documentFilename);
    for(const file of files) {
        fs.unlinkSync(path.join(databasePath, 'raw', folder, file));
        fs.unlinkSync(path.join(databasePath, 'tr', folder, file));
        const indexedFilename = `${folder}/${file}`;
        index.remove(indexedFilename);
    }
    return true;
}

async function addDocument(context: vscode.ExtensionContext, documentFilename: string
    , documentContent: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('dltxt');
    let GameTitle: string = config.get("trdb.project") as string;

    if (!GameTitle) {
        throw new Error('请先设置项目名称');
    }

    const [showError, diagnostics] = DocumentParser.errorCheck(documentContent);
    if (diagnostics.length > 0) {
        throw new Error(`文本格式错误 ${documentFilename}: ${diagnostics[0].message} line=${diagnostics[0].range.start.line+1}`);
    }
    //padding 1
    let lines = [''];
    let clines = [''];

    try {
        DocumentParser.processPairedLines(documentContent, (jgrps, cgrps) => {
            lines.push(jgrps.text);
            clines.push(cgrps.text);
        })
    } catch (e) {
        throw new Error(`无法加入数据库: ${documentFilename}, ${e}`)
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
    
    const databasePath = path.join(context.globalStorageUri.fsPath, 'trdb');
    fs.mkdirSync(path.join(databasePath, 'raw', GameTitle), {recursive: true});
    fs.mkdirSync(path.join(databasePath, 'tr', GameTitle), {recursive: true});

    const ChunkSize = 500;
    if (lines.length <= 2) {
        throw new Error('文本为空或格式错误');
    }
    for(let k = 1; k < lines.length-1; k += ChunkSize) {
        const indexedFilename = `${GameTitle}/${documentFilename}.${k}.txt`;
        const rIndexLines = lines.slice(k-1, k+ChunkSize+1);
        const rawContent = rIndexLines.join('\n');
        index.add(indexedFilename, rawContent);

        const trContent = clines.slice(k-1, k+ChunkSize+1).join('\n');

        fs.writeFileSync(path.join(databasePath, 'raw', indexedFilename), rawContent, { encoding: 'utf8'});
        fs.writeFileSync(path.join(databasePath, 'tr', indexedFilename), trContent, { encoding: 'utf8'});
    }
}

async function importDocument(context: vscode.ExtensionContext, docTrdbPath: string, docFolder: string, docFileName: string, replaceOnConflict: boolean): Promise<void> {
    const databasePath = path.join(context.globalStorageUri.fsPath, 'trdb');
    fs.mkdirSync(path.join(databasePath, 'raw', docFolder), {recursive: true});
    fs.mkdirSync(path.join(databasePath, 'tr', docFolder), {recursive: true});
    const firstIndexedFilename = `${databasePath}/${docFileName}.1.txt`;
    if (index.filenameToId.has(firstIndexedFilename)) {
        if (!replaceOnConflict) {
            return; // already indexed
        } else {
            index.remove(firstIndexedFilename);
            for (let k = 2; ; k++) {
                const indexedFilename = `${docFolder}/${docFileName}.${k}.txt`;
                if (!index.filenameToId.has(indexedFilename)) {
                    break; // no more files
                }
                index.remove(indexedFilename);
                fs.unlinkSync(path.join(databasePath, 'raw', indexedFilename));
                fs.unlinkSync(path.join(databasePath, 'tr', indexedFilename));
            }
        }
    }

    for (let k = 1; ; k++) {
        const indexedFilename = `${docFolder}/${docFileName}.${k}.txt`;
        const rawFilePath = path.join(docTrdbPath, 'raw', indexedFilename);
        const trFilePath = path.join(docTrdbPath, 'tr', indexedFilename);
        if (!fs.existsSync(rawFilePath) || !fs.existsSync(trFilePath)) {
            break; // no more files
        }
        const rawContent = fs.readFileSync(rawFilePath, { encoding: 'utf8' });
        const trContent = fs.readFileSync(trFilePath, { encoding: 'utf8' });

        index.add(indexedFilename, rawContent);
        fs.writeFileSync(path.join(databasePath, 'raw', indexedFilename), rawContent, { encoding: 'utf8'});
        fs.writeFileSync(path.join(databasePath, 'tr', indexedFilename), trContent, { encoding: 'utf8'});
    }
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

export function createFlexSearchIndex(): Index<IndexedDocument>{
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

function lockTRDBIndex(context: vscode.ExtensionContext): boolean {
    const lockFilePath = path.join(context.globalStorageUri.fsPath, "trdb-lock.json")
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

function unlockTRDBIndex(context: vscode.ExtensionContext, forced: boolean = false) {
    const lockFilePath = path.join(context.globalStorageUri.fsPath, "trdb-lock.json")
    try {
        fs.unlinkSync(lockFilePath);
    } catch (error) {
        if (!forced) {
            channel.appendLine(`Error releasing lock: ${error}`);
            channel.show();
        }
    }
}


async function TRDBCriticalSection(context: vscode.ExtensionContext, callback: () => any): Promise<any> {
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
    treeview: trdb_view.TRDBTreeView | undefined;
    constructor() {
        this.index = createFlexSearchIndex();
    }


    add(filename: string, content: string): boolean
    {
        if (this.filenameToId.has(filename)) {
            const id = this.filenameToId.get(filename) as number;
            this.index.update(id, content as any);
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
        const SearchIndexPath = path.join(context.globalStorageUri.fsPath, 'SearchIndex');
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

    load(context: vscode.ExtensionContext, forced: boolean = false, searchIndexPath: string = ''): boolean {
        const SearchIndexPath = searchIndexPath == '' ? path.join(context.globalStorageUri.fsPath, 'SearchIndex') : searchIndexPath;
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

        if (this.treeview) {
            this.treeview.refresh(context);
        }

        const IndexContent = fs.readFileSync(IndexPath, 'utf8');
        this.index.import(IndexContent);
        return true;
    }

    bind(treeview: trdb_view.TRDBTreeView) {
        this.treeview = treeview;
    }

    listFiles(cb: (folder: string, filenames: string[]) => void) {
        const folders = new Map<string, Set<string>>();
        for(const file of this.filenameToId.keys()) {
            const [folder, filename] = this.parseFilename(file);
            if (folders.has(folder)) {
                folders.get(folder)?.add(filename);
            } else {
                folders.set(folder, new Set([filename]));
            }
        }
        for(const [folder, files] of folders.entries()) {
            if (files.size > 0) {
                cb(folder, Array.from(files));
            } else {
                cb(folder, []);
            }
        }
    }

    filenamePattern = /(.*)\/(.*)(\.\d+)(\.txt)/;

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
        channel.appendLine(`-----------------------------`);
        channel.show();
    }
}

export class LineInfo {
    constructor(
        public fileName: string,
        public lineNumber: number,
        public jpLine: string,
        public trLine: string
    ) {}

    // define == operator for LineInfo
    public equals(other: LineInfo): boolean {
        return this.fileName === other.fileName &&
               this.lineNumber === other.lineNumber &&
               this.jpLine === other.jpLine &&
               this.trLine === other.trLine;
    }

    public urlString(): string {
        return `${this.fileName}:${this.lineNumber}`;
    }

    public toString(): string {
        return `${this.fileName}:${this.lineNumber} - ${this.jpLine} / ${this.trLine}`;
    }
}

class IdALlocator {
    private nestId: number = 0;
    private recycledIds: Set<number> = new Set();
    allocate(): number {
        if (this.recycledIds.size > 0) {
            const id = this.recycledIds.values().next().value;
            if (id !== undefined) {
                this.recycledIds.delete(id);
                return id;
            }
        }
        return this.nestId++;
    }
    recycle(id: number): void {
        this.recycledIds.add(id);
    }
}

export class MemoryCrossrefIndex {
    private index: Index<IndexedDocument>;
    idToLine: Map<number, LineInfo> = new Map();
    lineToId: Map<string, number> = new Map(); // filename:lineNumber => id
    fileUpdatedTime: Map<string, number> = new Map(); // filename => last modified time
    fileIds: Map<string, Set<number>> = new Map(); // filename => set of ids of lines in that file

    idAllocator: IdALlocator = new IdALlocator();
    constructor() {
        this.index = FlexSearch.create({
            profile: 'score',
            tokenize: 'strict',
            encode: "icase",
            split: /\s+/,
            async: false,
            filter: function (value) {
                return !StopWordsSet.has(value);
            }
        });
    }

    update(filename: string, getContent: () => [string[], number[], string[]]): boolean
    {
        const stat = fs.statSync(filename)
        if (this.fileUpdatedTime.has(filename)) {
            const lastModified = stat.mtimeMs;
            if (this.fileUpdatedTime.get(filename) === lastModified) {
                // no change, skip
                return false;
            }
        }
        this.fileUpdatedTime.set(filename, stat.mtimeMs);
        if (this.fileIds.has(filename)) {
            // remove old lines
            const ids = this.fileIds.get(filename) as Set<number>;
            for(const id of ids) {
                this.index.remove(id);
                this.idToLine.delete(id);
                this.lineToId.delete(`${filename}:${this.idToLine.get(id)?.lineNumber}`);
                this.idAllocator.recycle(id);
            }
        } else {
            this.fileIds.set(filename, new Set());
        }
        const thisFileIds = this.fileIds.get(filename) as Set<number>;
        const [jpLines, jpLineNumbers, trLines] = getContent();
        if (jpLines.length != trLines.length) {
            throw new Error(`文件 ${filename} 的日文和翻译行数不匹配`);
        }
        
        for(let i = 0; i < jpLines.length; i++) {
            const lineNumber = jpLineNumbers[i];
            const id = this.idAllocator.allocate();
            const lineInfo = new LineInfo(filename, lineNumber, jpLines[i], trLines[i]);
            this.idToLine.set(id, lineInfo);
            this.lineToId.set(`${filename}:${lineNumber}`, id);
            thisFileIds.add(id);
            this.index.add(id, jpLines[i]);
        }
        return true;
    }

    search(query: string, options?: number | SearchOptions): LineInfo[] {
        const res = this.index.search(query, options) as any as number[];
        const r: LineInfo[] = [];
        for (let i = 0; i < res.length; i++) {
            const lineInfo = this.idToLine.get(res[i]);
            if (lineInfo) {
                r.push(lineInfo);
            }
        }
        return r;
    }

}

export class Tokenizer {
    static downloadURL = 'https://github.com/jsc6924/translation-assistant/raw/master/data/dict.zip'
    static tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | undefined;
    static lock = new Semaphore(1);
    static async getAsync(context: vscode.ExtensionContext): Promise<Tokenizer> {
        await Tokenizer.lock.acquire();
        try {
            return await Tokenizer.init(context);
        } finally {
            Tokenizer.lock.release();
        }
    }

    static async init(context: vscode.ExtensionContext): Promise<Tokenizer> {
        if (!Tokenizer.tokenizer) {
            const dictPath = path.join(context.globalStorageUri.fsPath, "dict");
            if (!fs.existsSync(path.join(context.globalStorageUri.fsPath, "dict", "base.dat.gz"))) {
                const zipPath = path.join(context.globalStorageUri.fsPath, "dict.zip");
                if (fs.existsSync(zipPath)) {
                    channel.show();
                    channel.appendLine(`检测到目录下存在dict.zip，等待解压...`);
                    const p = new Promise((resolve, reject) => {
                        const watcher = fs.watch(zipPath, { persistent: false }, (event, filename) => {
                            if (event === 'rename') {
                                watcher.close(); // Close the watcher
                                channel.appendLine(`解压完成，初始化分词器...`);
                                resolve(undefined);
                            }
                        });
                    });
                    await p;
                } else {
                    channel.show();
                    channel.appendLine(`正在从 ${Tokenizer.downloadURL} 下载词典...`);
                    const zipFile = await downloadFile(Tokenizer.downloadURL, zipPath);
                    channel.appendLine(`下载完成，正在解压...`);
                    fs.mkdirSync(dictPath, {recursive: true});
                    const files = await unzipFile(zipFile, dictPath);
                    channel.appendLine(`解压完成，初始化分词器...`);
                    fs.unlinkSync(zipFile);
                }
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
                        channel.appendLine(`分词器初始化成功`);
                        Tokenizer.tokenizer = tokenizer;
                        resolve(new Tokenizer());
                    })
            })

        } else {
            return Promise.resolve(new Tokenizer);
        }
    }

    private constructor() {}

    tokenize(text: string): string {
        if (!Tokenizer.tokenizer) {
            return '';
        }
        return Tokenizer.tokenizer.tokenize(text).map((token) => token.surface_form).join(' ');
    }
}

export const TRDBIndex = new SearchIndex;
const index = TRDBIndex;
