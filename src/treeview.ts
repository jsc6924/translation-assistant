import * as vscode from 'vscode'
import { ClipBoardManager } from './clipboard';
import { SearchIndex, findBlocksForVirtualDocument } from './translation-db';
import { registerCommand, showOutputText } from './utils';
import * as fs from 'fs';
import * as path from "path";

// lets put all in a cwt namespace
export namespace dltxt
{
    class CustomItem extends vscode.TreeItem {
        raw: string = '';
        value: string = '';
        contextValue = 'key-value-item';
        constructor(raw: string, value: string) {
            super(`${raw}: ${value}`, vscode.TreeItemCollapsibleState.None);
            if (!value) {
                this.label = raw;
            }
            this.raw = raw;
            this.value = value;
        }
    }
    
    // 1. we'll export this class and use it in our extension later
    // 2. we need to implement vscode.TreeDataProvider
    export class DictTreeView implements vscode.TreeDataProvider<CustomItem>
    {
        // with the vscode.EventEmitter we can refresh our  tree view
        private m_onDidChangeTreeData: vscode.EventEmitter<CustomItem | undefined> = new vscode.EventEmitter<CustomItem | undefined>();
        // and vscode will access the event by using a readonly onDidChangeTreeData (this member has to be named like here, otherwise vscode doesnt update our treeview.
        readonly onDidChangeTreeData ? : vscode.Event<CustomItem | undefined> = this.m_onDidChangeTreeData.event;

        items: CustomItem[] = [];
        game = '';

        // we register two commands for vscode, item clicked (we'll implement later) and the refresh button. 
        public constructor()  {
            vscode.commands.registerCommand('Extension.dltxt.treeview.editItem', r => this.editItem(r));
            vscode.commands.registerCommand('Extension.dltxt.treeview.deleteItem', r => this.deleteItem(r));
        }

        getTreeItem(item: CustomItem): vscode.TreeItem {
            item.command = { command: 'Extension.dltxt.copyToClipboard', title : 'copy value', arguments: [{text: item.value}] };
            return item;
        }
    
        getChildren(element?: CustomItem): Thenable<CustomItem[]> {
            if (!this.game) {
                return Promise.resolve([new CustomItem('未连接SimpleTM数据库', '')]);
            }
            return Promise.resolve(this.items);
        }

        // this is called when we click an item
        public editItem(item: CustomItem) {
            vscode.commands.executeCommand('Extension.dltxt.dict_update', item.raw)
        }

        // this is called when we click an item
        public deleteItem(item: CustomItem) {
            vscode.commands.executeCommand('Extension.dltxt.dict_update', item.raw, true)
        }

        refresh(context: vscode.ExtensionContext) {
            const config = vscode.workspace.getConfiguration("dltxt");
            const game : string | undefined = config.get("simpleTM.project") as string;
            this.game = game;
            if (!game) {
                return;
            }

            this.items = []
            const keywords = context.workspaceState.get(`${game}.dict`) as Array<any>;
            for (let i = 0; i < keywords.length; i++) {
                let v = keywords[i];
                if(v['raw']) {
                    this.items.push(new CustomItem(v['raw'], v['translate']));
                }
            }
            this.items.sort((a, b) => {
                return a.raw.localeCompare(b.raw);
            })
            this.m_onDidChangeTreeData.fire(undefined);
        }

    }


    export class ValueItem extends vscode.TreeItem {
        value: string = '';
        index: string;
        contextValue = 'value-item';
        constructor(label: string, index: string, value: string) {
            super(label, vscode.TreeItemCollapsibleState.None);
            this.index = index;
            this.value = value;
            this.command = {
                command: 'Extension.dltxt.copyToClipboard', 
                title : 'copy value', 
                arguments: [{text: value}] 
            };
        }
    }

    export class ClipBoardTreeView implements vscode.TreeDataProvider<ValueItem>
    {
        // with the vscode.EventEmitter we can refresh our  tree view
        private m_onDidChangeTreeData: vscode.EventEmitter<ValueItem | undefined> = new vscode.EventEmitter<ValueItem | undefined>();
        // and vscode will access the event by using a readonly onDidChangeTreeData (this member has to be named like here, otherwise vscode doesnt update our treeview.
        readonly onDidChangeTreeData ? : vscode.Event<ValueItem | undefined> = this.m_onDidChangeTreeData.event;

        items: ValueItem[] = [];

        constructor(context: vscode.ExtensionContext) {
            this.refresh(context);
        }
        getTreeItem(item: ValueItem): vscode.TreeItem {
            return item;
        }
    
        getChildren(element?: ValueItem): Thenable<ValueItem[]> {
            return Promise.resolve(this.items);
        }

        refresh(context: vscode.ExtensionContext) {
            const prefix = 'clipboard.customString';
            this.items = []
            for (let i = 1; i <= 6; i++) {
                const k = prefix + String(i);
                const v = ClipBoardManager.get(context, k);
                this.items.push(new ValueItem(`${i}: ${v}`, String(i), v));
            }
            this.m_onDidChangeTreeData.fire(undefined);
        }
    }


    class TRDBItem extends vscode.TreeItem {
        constructor(label: string, collapsibleState?: vscode.TreeItemCollapsibleState) {
            super(label, collapsibleState);
        }
    }

    export class TRDBFolderItem extends TRDBItem {
        folder: string = '';
        contextValue = 'trdb-folder';
        constructor(folder: string) {
            super(folder, vscode.TreeItemCollapsibleState.Collapsed);
            this.folder = folder;
        }
    }

    export class TRDBFileItem extends TRDBItem {
        filename: string;
        folder: string;
        contextValue = 'trdb-file';
        constructor(folder: string, filename: string) {
            super(filename, vscode.TreeItemCollapsibleState.None);
            this.folder = folder;
            this.filename = filename;
            this.command = {
                command: 'Extension.dltxt.trdb.openVirtualFile', 
                title : 'copy value', 
                arguments: [{folder: folder, filename: filename}] 
            };
        }
    }


    export class TRDBTreeView implements vscode.TreeDataProvider<TRDBItem>
    {
        // with the vscode.EventEmitter we can refresh our  tree view
        private m_onDidChangeTreeData: vscode.EventEmitter<TRDBItem | undefined> = new vscode.EventEmitter<TRDBItem | undefined>();
        // and vscode will access the event by using a readonly onDidChangeTreeData (this member has to be named like here, otherwise vscode doesnt update our treeview.
        readonly onDidChangeTreeData ? : vscode.Event<TRDBItem | undefined> = this.m_onDidChangeTreeData.event;

        items: TRDBItem[] = [];
        index: SearchIndex;

        constructor(context: vscode.ExtensionContext, index: SearchIndex) {
            this.index = index;
            this.refresh(context);
            registerCommand(context, "Extension.dltxt.trdb.openVirtualFile", (args) => {
                const folder = args.folder;
                const filename = args.filename;
                const databasePath = path.join(context.globalStoragePath, 'trdb');
                const files = findBlocksForVirtualDocument(context, folder, filename);
                files.sort((a, b) => {
                    return a.localeCompare(b);
                });
                const rlines = [];
                const tlines = [];
                for (const file of files) {
                    const rc = fs.readFileSync(path.join(databasePath, 'raw', folder, file), {encoding: 'utf8'});
                    const tc = fs.readFileSync(path.join(databasePath, 'tr', folder, file), {encoding: 'utf8'});
                    const rawLines = rc.split('\n');
                    const trLines = tc.split('\n');
                    if (rawLines.length != trLines.length) {
                        throw new Error(`line count not matched: ${file}`);
                    }
                    const rltrimed = rawLines.slice(1, rawLines.length - 1);
                    const tltrimed = trLines.slice(1, rawLines.length - 1);

                    rlines.push(...rltrimed);
                    tlines.push(...tltrimed);
                }
                const lines = [];
                for(let i = 0; i < rlines.length; i++) {
                    const tag = `${(i+1).toString().padStart(6, '0')}`;
                    lines.push(`[${tag}]` + rlines[i].replace(/\s+/g, ''));
                    lines.push(`;[${tag}]` + tlines[i]);
                    lines.push('');
                }
                showOutputText(`${folder}/${filename}`, lines.join('<br>'));
            })
        }
        getTreeItem(item: TRDBItem): vscode.TreeItem {
            return item;
        }
    
        getChildren(element?: TRDBItem): Thenable<TRDBItem[]> {
            if (!element) {
                return Promise.resolve(this.items);
            }
            if (element.contextValue == 'trdb-folder') {
                const folderItem = element as TRDBFolderItem;
                const files = this.index.virtualDirectory.get(folderItem.folder);
                if (!files) {
                    return Promise.resolve([]);
                }
                const items = [];
                for(const file of files) {
                    items.push(new TRDBFileItem(folderItem.folder, file));
                }
                items.sort((a, b) => {
                    return a.filename.localeCompare(b.filename);
                })
                return Promise.resolve(items);
            }
            return Promise.resolve([]);
        }

        refresh(context: vscode.ExtensionContext) {
            this.items = [];
            const folders = this.index.virtualDirectory.keys();
            const temp: TRDBFolderItem[] = [];
            for(const folder of folders) {
                temp.push(new TRDBFolderItem(folder));
            }
            temp.sort((a, b) => {
                return a.folder.localeCompare(b.folder);
            });
            this.items = temp;
            this.m_onDidChangeTreeData.fire(undefined);
        }
    }
}