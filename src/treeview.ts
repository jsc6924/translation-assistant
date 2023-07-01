import * as vscode from 'vscode'
import { ClipBoardManager } from './clipboard';
import { SearchIndex, findBlocksForVirtualDocument } from './translation-db';
import { registerCommand, showOutputText, DictSettings, ContextHolder } from './utils';
import * as fs from 'fs';
import * as path from "path";
import { SimpleTMDefaultURL } from './simpletm';

// lets put all in a cwt namespace
export namespace dltxt
{
    export class DictItem extends vscode.TreeItem {
        contextValue = 'dict-item';
        treeview: DictTreeView;
        constructor(treeview: DictTreeView, label: string, state: vscode.TreeItemCollapsibleState) {
            super(label, state);
            this.treeview = treeview;
        }
    }

    export class DictRootItem extends DictItem {
        dictName: string;
        contextValue = 'dict-root-item';
        children: DictItem[] = [];
        constructor(treeview: DictTreeView, dictName: string, state: vscode.TreeItemCollapsibleState) {
            super(treeview, dictName, state);
            this.dictName = dictName;
            this.iconPath = new vscode.ThemeIcon('database');
        }
    }

    class DictConfigRootItem extends DictItem {
        contextValue = 'dict-config-root-item';
        children: DictConfigEntryItem[] = [];
        iconPath = new vscode.ThemeIcon('settings-gear');
        dictName: string;
        constructor(treeview: DictTreeView, label: string, dictName: string, state: vscode.TreeItemCollapsibleState) {
            super(treeview, label, state);
            this.dictName = dictName;
        }

        
        async configUpdated() {
            for(const child of this.children) {
                if (!child.getValue()) {
                    return;
                }
            }
            await vscode.commands.executeCommand('Extension.dltxt.sync_database', this.dictName);
        }
    }
    class DictConfigEntryItem extends DictItem {
        contextValue = 'dict-config-entry-item';
        config: string;
        showFullValue: boolean;
        global: boolean;
        initLabel: string;
        constructor(treeview: DictTreeView, configRoot: DictConfigRootItem,
             label: string, config: string, global: boolean, showFullValue: boolean) {
            super(treeview, label, vscode.TreeItemCollapsibleState.None);
            this.initLabel = label;
            this.config = config;
            this.showFullValue = showFullValue;
            this.global = global;
            this.updateLabel();
            const cb = async () => { 
                this.updateLabel(); 
                await configRoot.configUpdated();
                treeview.dataChanged();
            };
            if (global) {
                this.iconPath = new vscode.ThemeIcon('symbol-property');
                this.command = {
                    command: 'Extension.dltxt.setGlobalState',
                    title: `更改全局变量${config}`,
                    arguments: [{config: config, callback: cb}]
                }
            } else {
                this.iconPath = new vscode.ThemeIcon('settings');
                this.command = {
                    command: 'Extension.dltxt.setWorkspaceState',
                    title: `更改当前工作区变量${config}`,
                    arguments: [{config: config, callback: cb}]
                }
            }
        }

        getValue() {
            if (this.global) {
                return ContextHolder.getGlobalState(this.config);
            }
            return ContextHolder.getWorkspaceState(this.config);
        }

        updateLabel() {
            let v = undefined;
            if (this.global) {
                v = ContextHolder.getGlobalState(this.config) as string;
            } else {
                v = ContextHolder.getWorkspaceState(this.config) as string;
            }
            if (v !== undefined) {
                if (!this.showFullValue) {
                    v = v.slice(0, 3) + '******';
                }
                this.label = `${this.initLabel}: ${v}`
            }
        }

        
    }
    class DictEntrySetItem extends DictItem {
        contextValue = 'dict-entry-set-item';
        children: DictEntryItem[] = [];
        iconPath = new vscode.ThemeIcon('book');
    }
    class DictEntryItem extends DictItem {
        name: string = '';
        key: string = '';
        value: string = '';
        contextValue = 'dict-entry-item';
        constructor(treeview: DictTreeView, name: string, key: string, value: string) {
            super(treeview, `${key}: ${value}`, vscode.TreeItemCollapsibleState.None);
            if (!value) {
                this.label = key;
            }
            this.name = name;
            this.key = key;
            this.value = value;
            this.iconPath = new vscode.ThemeIcon('circle-filled');
            this.command = { command: 'Extension.dltxt.copyToClipboard', 
                title : 'copy value',
                arguments: [{text: this.value}]
            };
        }
    }
    class DictPlaceholderItem extends DictItem {
        contextValue = 'dict-placeholder-item';
    }

    
    // 1. we'll export this class and use it in our extension later
    // 2. we need to implement vscode.TreeDataProvider
    export class DictTreeView implements vscode.TreeDataProvider<DictItem>
    {
        // with the vscode.EventEmitter we can refresh our  tree view
        private m_onDidChangeTreeData: vscode.EventEmitter<DictItem | undefined> = new vscode.EventEmitter<DictItem | undefined>();
        // and vscode will access the event by using a readonly onDidChangeTreeData (this member has to be named like here, otherwise vscode doesnt update our treeview.
        readonly onDidChangeTreeData ? : vscode.Event<DictItem | undefined> = this.m_onDidChangeTreeData.event;

        game = '';
        roots: DictRootItem[] = [];

        // we register two commands for vscode, item clicked (we'll implement later) and the refresh button. 
        public constructor()  {
            vscode.commands.registerCommand('Extension.dltxt.treeview.editItem', r => this.editItem(r));
            vscode.commands.registerCommand('Extension.dltxt.treeview.deleteItem', r => this.deleteItem(r));
            this.refresh();
        }

        addRemoteDict(name: string, values? : any): boolean {
            DictSettings.setDictType(name, 'remote');
            if (values) {
                DictSettings.setSimpleTMUrl(name, values.url);
                DictSettings.setSimpleTMApiToken(name, values.api);
                DictSettings.setSimpleTMUsername(name, values.user);
                DictSettings.setGameTitle(name, values.game);
            }
            if (!DictSettings.getSimpleTMUrl(name)) {
                DictSettings.setSimpleTMUrl(name, SimpleTMDefaultURL);
            }
            const simpleTMNode = new DictRootItem(this, name, vscode.TreeItemCollapsibleState.Expanded);
            const simpleTMConfigNode = new DictConfigRootItem(this, '设置', name, vscode.TreeItemCollapsibleState.Collapsed);
            simpleTMConfigNode.children.push(new DictConfigEntryItem(this, simpleTMConfigNode,  `服务器网址`, `dltxt.dict.${name}.url`, true, true));
            simpleTMConfigNode.children.push(new DictConfigEntryItem(this, simpleTMConfigNode, `用户名`, `dltxt.dict.${name}.username`, true, true));
            simpleTMConfigNode.children.push(new DictConfigEntryItem(this, simpleTMConfigNode, `APIToken`, `dltxt.dict.${name}.api`, true, false));
            simpleTMConfigNode.children.push(new DictConfigEntryItem(this, simpleTMConfigNode, `项目名`, `dltxt.dict.${name}.gameTitle`, false, true));
            simpleTMNode.children.push(simpleTMConfigNode);

            simpleTMNode.children.push(new DictEntrySetItem(this, `内容`, vscode.TreeItemCollapsibleState.Expanded));
            this.roots.push(simpleTMNode);
            this.refresh(simpleTMNode);
            return true;
        }

        removeRemoteDict(item: dltxt.DictRootItem) {
            const index = this.roots.indexOf(item);
            if (index != -1) {
                this.roots.splice(index, 1);
            }
            this.dataChanged();
        }

        getTreeItem(item: DictItem): vscode.TreeItem {
            return item;
        }
    
        getChildren(element?: DictItem): Thenable<DictItem[]> {
            if (!element) {
                return Promise.resolve(this.roots);
            }
            if (element.contextValue == 'dict-root-item') {
                return Promise.resolve((element as DictRootItem).children);
            }
            if (element.contextValue == 'dict-entry-set-item') {
                return Promise.resolve((element as DictEntrySetItem).children);
            }
            if (element.contextValue == 'dict-config-root-item') {
                return Promise.resolve((element as DictConfigRootItem).children);
            }
            return Promise.resolve([]);
        }

        // this is called when we click an item
        public editItem(item: DictEntryItem) {
            vscode.commands.executeCommand('Extension.dltxt.dict_update', item.name, item.key)
        }

        // this is called when we click an item
        public deleteItem(item: DictEntryItem) {
            vscode.commands.executeCommand('Extension.dltxt.dict_update', item.name, item.key, true)
        }

        dataChanged() {
            this.m_onDidChangeTreeData.fire(undefined);
        }

        getDictByName(name: string) {
            for(const node of this.roots) {
                if (node.dictName === name) {
                    return node;
                }
            }
            return undefined;
        }

        refresh(element?: DictItem) {
            if (!element) {
                this.roots = [];
                const dictNames = DictSettings.getAllDictNames();
                
                for(const name of dictNames) {
                    const type = DictSettings.getDictType(name);
                    if (type == 'remote') {
                        this.addRemoteDict(name);
                    }
                }
                
            } 
            else if (element.contextValue == 'dict-root-item') {
                const node = element as DictRootItem;
                const game : string | undefined = DictSettings.getGameTitle(node.dictName);
                if (!game) {
                    return;
                }
                this.game = game;
    
                const dictEntryItems = [];
                const keywords = DictSettings.getSimpleTMDictKeys(node.dictName, game);
                for (let i = 0; i < keywords.length; i++) {
                    let v = keywords[i];
                    if(v['raw']) {
                        dictEntryItems.push(new DictEntryItem(this, node.dictName, v['raw'], v['translate']));
                    }
                }
                dictEntryItems.sort((a, b) => {
                    return a.key.localeCompare(b.key);
                });
                (node.children[1] as DictEntrySetItem).children = dictEntryItems;
                for (const item of (node.children[0] as DictConfigRootItem).children) {
                    item.updateLabel();
                }
            }
            else if (element.contextValue == 'dict-entry-set-item') {
                
            }
            else if (element.contextValue == 'dict-config-root-item') {
                
            }

            this.m_onDidChangeTreeData.fire(undefined);
            
        }

    }


    export class ValueItem extends vscode.TreeItem {
        value: string = '';
        index: string;
        contextValue = 'value-item';
        iconPath = new vscode.ThemeIcon('symbol-key');
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
        iconPath = new vscode.ThemeIcon('folder');
        constructor(folder: string) {
            super(folder, vscode.TreeItemCollapsibleState.Collapsed);
            this.folder = folder;
        }
    }

    export class TRDBFileItem extends TRDBItem {
        filename: string;
        folder: string;
        contextValue = 'trdb-file';
        iconPath = new vscode.ThemeIcon('file');
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