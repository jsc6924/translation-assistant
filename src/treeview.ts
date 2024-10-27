import * as vscode from 'vscode'
import { ClipBoardManager } from './clipboard';
import { SearchIndex, findBlocksForVirtualDocument } from './translation-db';
import { registerCommand, showOutputText, DictSettings, ContextHolder, CSSNamedColors, DictType, DltxtDiagCollection, DltxtDiagCollectionMissionLine, DltxtDiagCollectionSpellcheck, escapeHtml } from './utils';
import * as fs from 'fs';
import * as path from "path";
import { SimpleTMDefaultURL, updateKeywordDecorations } from './simpletm';
import { downloadDefaultServer, stopDictServer } from './dictserver';
import { channel } from './dlbuild';
import { clearAllWarnings } from './error-check';
import { batchCheckCommand, batchInsertNewline } from './batch';


export class BasicTreeItem extends vscode.TreeItem {
    constructor(label: string, state: vscode.TreeItemCollapsibleState) {
        super(label, state);
    }

    getChildren(): BasicTreeItem[]  {
        return [];
    }
}

export class TreeItem<T> extends BasicTreeItem {
    contextValue = '';
    treeview: T;
    constructor(treeview: T, label: string, state: vscode.TreeItemCollapsibleState) {
        super(label, state);
        this.treeview = treeview;
    }
}

export class CommandItem extends BasicTreeItem {
    iconPath = new vscode.ThemeIcon('debug-start');
    constructor(label: string, callback: (() => void) | undefined) {
        super(label, vscode.TreeItemCollapsibleState.None);

        this.command = {
            command: 'Extension.dltxt.executeFunction',
            title: `执行`,
            arguments: [{callback}]
        }
    }
}

export class ConfigRootItem<T> extends TreeItem<T> {
    children: BasicTreeItem[] = [];
    iconPath = new vscode.ThemeIcon('settings-gear');
    constructor(treeview: T, label: string, state: vscode.TreeItemCollapsibleState) {
        super(treeview, label, state);
    }

    getChildren(): BasicTreeItem[] {
        return this.children;
    }
    
    async configUpdated() {
        //pass
    }
}

export class ConfigEntryItem<T> extends TreeItem<T> {
    config: string;
    showFullValue: boolean;
    global: boolean;
    initLabel: string;

    configRoot: ConfigRootItem<T>;
    treeview: T;
    async callback() {
        this.updateLabel(); 
        await this.configRoot.configUpdated();
        (this.treeview as any).dataChanged();
    }
    constructor(treeview: T, configRoot: ConfigRootItem<T>,
         label: string, config: string, global: boolean, showFullValue: boolean) {
        super(treeview, label, vscode.TreeItemCollapsibleState.None);
        this.initLabel = label;
        this.config = config;
        this.showFullValue = showFullValue;
        this.global = global;
        this.updateLabel();
        this.configRoot = configRoot;
        this.treeview = treeview;
        let usePathPicker = false;
        if (config.includes('.localPath')) {
            usePathPicker = true;
        }
        this.setCommand(global, {config, usePathPicker, callback: () => this.callback()});
    }

    setCommand(global: boolean, args: any) {
        if (global) {
            this.iconPath = new vscode.ThemeIcon('symbol-property');
            this.command = {
                command: 'Extension.dltxt.setGlobalState',
                title: `更改全局变量${this.config}`,
                arguments: [args]
            }
        } else {
            this.iconPath = new vscode.ThemeIcon('settings');
            this.command = {
                command: 'Extension.dltxt.setWorkspaceState',
                title: `更改当前工作区变量${this.config}`,
                arguments: [args]
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
        } else {
            this.label = `${this.initLabel}`
        }
    }
}

export class ConfigSelectionEntryItem<T> extends ConfigEntryItem<T> {
    selections: string[] = [];
    constructor(treeview: T, configRoot: ConfigRootItem<T>,
        label: string, config: string, global: boolean, selections: string[], defaultValue: string) {
        super(treeview, configRoot, label, config, global, true);
        this.selections = selections;
        this.setCommand(global, {config, callback: () => this.callback(), selections: this.selections});
        if (global) {
            if (ContextHolder.getGlobalState(this.config) === undefined) {
                ContextHolder.setGlobalState(this.config, defaultValue);
            }
        } else {
            if (ContextHolder.getWorkspaceState(this.config) === undefined) {
                ContextHolder.setWorkspaceState(this.config, defaultValue);
            }
        }
        this.updateLabel();
    }
}

export class BasicTreeView<Item extends BasicTreeItem> implements vscode.TreeDataProvider<Item>
{
    // with the vscode.EventEmitter we can refresh our  tree view
    private m_onDidChangeTreeData: vscode.EventEmitter<Item | undefined> = new vscode.EventEmitter<Item | undefined>();
    // and vscode will access the event by using a readonly onDidChangeTreeData (this member has to be named like here, otherwise vscode doesnt update our treeview.
    readonly onDidChangeTreeData ? : vscode.Event<Item | undefined> = this.m_onDidChangeTreeData.event;

    roots: Item[] = [];

    getTreeItem(item: Item): vscode.TreeItem {
        return item;
    }

    getChildren(element?: Item): Thenable<Item[]> {
        if (!element) {
            return Promise.resolve(this.roots);
        }
        return Promise.resolve(element.getChildren() as Item[]);
    }

    dataChanged() {
        this.m_onDidChangeTreeData.fire(undefined);
    }
}

// lets put all in a cwt namespace
export namespace dict_view
{
    class DictItem extends TreeItem<DictTreeView> {};
    export class DictRootItem extends DictItem {
        dictName: string;
        contextValue = 'dict-root-item';
        children: DictItem[] = [];
        contentNode: DictEntrySetItem | undefined;
        connected: boolean = false;
        constructor(treeview: DictTreeView, dictName: string, state: vscode.TreeItemCollapsibleState) {
            super(treeview, dictName, state);
            this.dictName = dictName;
            this.iconPath = new vscode.ThemeIcon('database');
            this.setConnectionStatus(false);
        }
        getChildren(): BasicTreeItem[] {
            return this.children;
        }
        findEntryValue(key: string) {
            if (this.contentNode) {
                for(const child of this.contentNode.children) {
                    if (child.key === key) {
                        return child.value;
                    }
                }
            }
            return undefined;
        }
        setConnectionStatus(connected: boolean) {
            this.connected = connected;
            if (connected) {
                this.label = `${this.dictName}[=]`;
            } else {
                this.label = `${this.dictName}[x]`;
            }
        }
    }

    class DictConfigRootItem extends ConfigRootItem<DictTreeView> {
        dictName: string;
        constructor(treeview: DictTreeView, label: string, dictName: string, state: vscode.TreeItemCollapsibleState) {
            super(treeview, label, state);
            this.dictName = dictName;
        }
        
        async configUpdated() {
            for(const child of this.children as DictConfigEntryItem[]) {
                if (!child.getValue()) {
                    const root = this.treeview.getDictByName(this.dictName);
                    root?.setConnectionStatus(false);
                    root?.contentNode?.clear();
                    return;
                }
            }
            await vscode.commands.executeCommand('Extension.dltxt.sync_database', this.dictName);
        }
    }
    class DictConfigStyleRootItem extends ConfigRootItem<DictTreeView> {
        dictName: string;
        constructor(treeview: DictTreeView, label: string, dictName: string, state: vscode.TreeItemCollapsibleState) {
            super(treeview, label, state);
            this.dictName = dictName;
        }

        getChildren(): BasicTreeItem[] {
            return this.children;
        }

        async configUpdated() {
            updateKeywordDecorations();
        }
    }

    class DictConfigEntryItem extends ConfigEntryItem<DictTreeView> {
        async callback() {
            this.updateLabel();
            if (!ContextHolder.getWorkspaceState(this.config)) {
                const dictName = (this.configRoot as DictConfigRootItem).dictName;
                DictSettings.clearLocalDict(dictName);
            }
            await this.configRoot.configUpdated();
            this.treeview.dataChanged();
        }
    }
    class DictConfigSelectionEntryItem extends ConfigSelectionEntryItem<DictTreeView>{}

    class DictEntrySetItem extends DictItem {
        contextValue = 'dict-entry-set-item';
        children: DictEntryItem[] = [];
        iconPath = new vscode.ThemeIcon('book');
        name: string  = '';
        filter: string = '';
        filterEnabled: boolean = false;
        constructor(name: string, treeview: DictTreeView, label: string, state: vscode.TreeItemCollapsibleState) {
            super(treeview, label, state);
            this.name = name;
        }
        clear() {
            this.children = [];
            this.treeview.dataChanged();
        }
        toggleFilter(filter: string) {
            if (this.filterEnabled) {
                this.filter = '';
                this.label = '内容';
            } else {
                this.filter = filter;
                this.label = `内容（查找：${filter}）`;
            }
            this.filterEnabled = !this.filterEnabled;
        }
        filterIsEnabled() {
            return this.filterEnabled;
        }
        getChildren() {
            if (!this.filterEnabled) {
                return this.children;
            }
            return this.children.filter((d => {
                return d.key.includes(this.filter) || d.value.includes(this.filter);
            }))
        }
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

    
    export class DictTreeView extends BasicTreeView<DictItem>
    {
        // we register two commands for vscode, item clicked (we'll implement later) and the refresh button. 
        public constructor()  {
            super();
            vscode.commands.registerCommand('Extension.dltxt.treeview.filter', r => this.filterDict(r));
            vscode.commands.registerCommand('Extension.dltxt.treeview.addItem', r => this.addItem(r));
            vscode.commands.registerCommand('Extension.dltxt.treeview.editItem', r => this.editItem(r));
            vscode.commands.registerCommand('Extension.dltxt.treeview.deleteItem', r => this.deleteItem(r));
            this.refresh();
        }

        addRemoteUserDict(name: string, values? : any): boolean {
            DictSettings.setDictType(name, DictType.RemoteUser);
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
            const simpleTMConfigNode = new DictConfigRootItem(this, '连接', name, vscode.TreeItemCollapsibleState.Collapsed);
            simpleTMConfigNode.children.push(new DictConfigEntryItem(this, simpleTMConfigNode,  `服务器网址`, `dltxt.dict.${name}.url`, true, true));
            simpleTMConfigNode.children.push(new DictConfigEntryItem(this, simpleTMConfigNode, `用户名`, `dltxt.dict.${name}.username`, true, true));
            simpleTMConfigNode.children.push(new DictConfigEntryItem(this, simpleTMConfigNode, `APIToken`, `dltxt.dict.${name}.api`, true, false));
            simpleTMConfigNode.children.push(new DictConfigEntryItem(this, simpleTMConfigNode, `项目名`, `dltxt.dict.${name}.gameTitle`, false, true));
            simpleTMNode.children.push(simpleTMConfigNode);

            const styleNode = this.constructStyleNode(name);
            simpleTMNode.children.push(styleNode);

            simpleTMNode.contentNode = new DictEntrySetItem(name, this, `内容`, vscode.TreeItemCollapsibleState.Expanded);
            simpleTMNode.children.push(simpleTMNode.contentNode);
            
            this.roots.push(simpleTMNode);
            this.refresh(simpleTMNode);
            return true;
        }

        addRemoteURLDict(name: string): boolean {
            DictSettings.setDictType(name, DictType.RemoteURL);
            const simpleTMNode = new DictRootItem(this, name, vscode.TreeItemCollapsibleState.Expanded);
            const simpleTMConfigNode = new DictConfigRootItem(this, '连接', name, vscode.TreeItemCollapsibleState.Collapsed);
            simpleTMConfigNode.children.push(new DictConfigEntryItem(this, simpleTMConfigNode,  `共享URL`, `dltxt.dict.${name}.shared_url`, false, true));
            simpleTMNode.children.push(simpleTMConfigNode);

            const styleNode = this.constructStyleNode(name);
            simpleTMNode.children.push(styleNode);

            simpleTMNode.contentNode = new DictEntrySetItem(name, this, `内容`, vscode.TreeItemCollapsibleState.Expanded);
            simpleTMNode.children.push(simpleTMNode.contentNode);
            
            this.roots.push(simpleTMNode);
            this.refresh(simpleTMNode);
            return true;
        }

        addLocalDict(name: string): boolean {
            DictSettings.setDictType(name, DictType.Local);
            const rootNode = new DictRootItem(this, name, vscode.TreeItemCollapsibleState.Expanded);
            const simpleTMConfigNode = new DictConfigRootItem(this, '连接', name, vscode.TreeItemCollapsibleState.Collapsed);
            simpleTMConfigNode.children.push(
                new DictConfigEntryItem(this, simpleTMConfigNode, `本地路径`, `dltxt.dict.${name}.localPath`, false, true));
            rootNode.children.push(simpleTMConfigNode);

            const styleNode = this.constructStyleNode(name);
            rootNode.children.push(styleNode);

            rootNode.contentNode = new DictEntrySetItem(name, this, `内容`, vscode.TreeItemCollapsibleState.Expanded);
            rootNode.children.push(rootNode.contentNode);
            this.roots.push(rootNode);
            this.refresh(rootNode);
            return true;
        }

        constructStyleNode(name: string) {
            const styleNode = new DictConfigStyleRootItem(this, '外观', name, vscode.TreeItemCollapsibleState.Collapsed);
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `显示高亮`, `dltxt.dict.${name}.style.show`, true, ['true', 'false'], 'true'));
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `预览条颜色`, `dltxt.dict.${name}.style.overviewColor`, true, CSSNamedColors, 'blue'));
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `预览条位置`, `dltxt.dict.${name}.style.overviewPosition`, true, ['left', 'right', 'center', 'full'], 'right'));
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `边框宽度`, `dltxt.dict.${name}.style.BorderWidth`, true, ['1px', '0 0 1px 0', '0'], '1px'));
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `边框样式`, `dltxt.dict.${name}.style.BorderStyle`, true, ['solid', 'dotted', 'dashed', 'double', 'none'], 'solid'));
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `边框半径`, `dltxt.dict.${name}.style.BorderRadius`, true, ['0', '2px', '3px', '5px', '8px', '10px'], '3px'));
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `浅色主题高亮颜色`, `dltxt.dict.${name}.style.light.backgroundColor`, true, CSSNamedColors, 'lightblue'));
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `浅色主题边框颜色`, `dltxt.dict.${name}.style.light.borderColor`, true, CSSNamedColors, 'darkblue'));
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `深色主题高亮颜色`, `dltxt.dict.${name}.style.dark.backgroundColor`, true, CSSNamedColors, 'darkblue'));
            styleNode.children.push(new DictConfigSelectionEntryItem(this, styleNode, `深色主题边框颜色`, `dltxt.dict.${name}.style.dark.borderColor`, true, CSSNamedColors, 'lightblue'));

            return styleNode;
        }

        removeDict(item: dict_view.DictRootItem) {
            const index = this.roots.indexOf(item);
            if (index != -1) {
                this.roots.splice(index, 1);
            }
            this.dataChanged();
        }

        public addItem(item: DictEntrySetItem) {
            vscode.commands.executeCommand('Extension.dltxt.dict_insert', item.name)
        }

        public async filterDict(item: DictEntrySetItem) {
            if (item.filterIsEnabled()) {
                item.toggleFilter('');
            } else {
                const r = await vscode.window.showInputBox({
                    prompt: `输入想要查找的内容`
                });
                if (!r) {
                    return;
                }
                item.toggleFilter(r);
            }
            this.dataChanged();
        }

        // this is called when we click an item
        public editItem(item: DictEntryItem) {
            vscode.commands.executeCommand('Extension.dltxt.dict_update', item.name, item.key)
        }

        // this is called when we click an item
        public deleteItem(item: DictEntryItem) {
            vscode.commands.executeCommand('Extension.dltxt.dict_update', item.name, item.key, true)
        }

        getDictByName(name: string) {
            for(const node of this.roots as DictRootItem[]) {
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
                    if (type == DictType.RemoteUser) {
                        this.addRemoteUserDict(name);
                    }
                    else if (type == DictType.RemoteURL) {
                        this.addRemoteURLDict(name);
                    }
                    else if (type == DictType.Local) {
                        this.addLocalDict(name);
                    }
                }
                
            } 
            else if (element.contextValue == 'dict-root-item') {
                const node = element as DictRootItem;
                const type = DictSettings.getDictType(node.dictName);

                let keywords: any[] = [];
                if (type == DictType.RemoteUser || type == DictType.RemoteURL) {
                    const game : string | undefined = DictSettings.getGameTitle(node.dictName);
                    if (!game || !node.connected) {
                        node.contentNode?.clear();
                        return;
                    }
                    keywords = DictSettings.getSimpleTMDictKeys(node.dictName, game);
                } else if (type == DictType.Local) {
                    keywords = DictSettings.getLocalDictKeys(node.dictName);
                }

                const dictEntryItems = [];
                for (let i = 0; i < keywords.length; i++) {
                    let v = keywords[i];
                    if(v['raw']) {
                        dictEntryItems.push(new DictEntryItem(this, node.dictName, v['raw'], v['translate']));
                    }
                }
                dictEntryItems.sort((a, b) => {
                    return String(a.key).localeCompare(b.key);
                });
                (node.contentNode as DictEntrySetItem).children = dictEntryItems;
                for (const item of (node.children[0] as DictConfigRootItem).getChildren()) {
                    (item as DictConfigEntryItem).updateLabel();
                }
            }

            this.dataChanged();
        }

    }
}
export namespace trdb_view {
    class TRDBItem extends BasicTreeItem {}

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


    export class TRDBTreeView extends BasicTreeView<TRDBItem>
    {
        index: SearchIndex;

        constructor(context: vscode.ExtensionContext, index: SearchIndex) {
            super();
            this.index = index;
            this.refresh(context);
            registerCommand(context, "Extension.dltxt.trdb.openVirtualFile", (args) => {
                const folder = args.folder;
                const filename = args.filename;
                const databasePath = path.join(context.globalStorageUri.fsPath, 'trdb');
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
                    lines.push(`[${tag}]` + escapeHtml(rlines[i].replace(/\s+/g, '')));
                    lines.push(`;[${tag}]` + escapeHtml(tlines[i]));
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
                return Promise.resolve(this.roots);
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
            this.roots = [];
            const folders = this.index.virtualDirectory.keys();
            const temp: TRDBFolderItem[] = [];
            for(const folder of folders) {
                temp.push(new TRDBFolderItem(folder));
            }
            temp.sort((a, b) => {
                return a.folder.localeCompare(b.folder);
            });
            this.roots = temp;
            this.dataChanged();
        }
    }
}

export namespace cc_view {
    class CCDirectory extends TreeItem<CCTreeView> {
        children: BasicTreeItem[] = [];
        iconPath = new vscode.ThemeIcon('debug-collapse-all');
        getChildren(): BasicTreeItem[] {
            return this.children;
        }
    };



    export class CCTreeView extends BasicTreeView<TreeItem<CCTreeView>>
    {
        constructor(context: vscode.ExtensionContext) {
            super();
            const baiduAPINode = new ConfigRootItem(this, "百度智能云API", vscode.TreeItemCollapsibleState.Collapsed);
            baiduAPINode.children.push(new ConfigEntryItem(this, baiduAPINode, "AccessKey", "dltxt.config.baidu.accesskey", true, false));
            baiduAPINode.children.push(new ConfigEntryItem(this, baiduAPINode, "SecretKey", "dltxt.config.baidu.secretkey", true, false));
            this.roots.push(baiduAPINode);

            const dictServerNode = new CCDirectory(this, "辞典服务器", vscode.TreeItemCollapsibleState.Collapsed);
            this.roots.push(dictServerNode);

            dictServerNode.children.push(new CommandItem("关闭辞典服务器", () => {
                if(!stopDictServer()) {
                    vscode.window.showInformationMessage("当前没有辞典服务器在运行，或者辞典服务器不是由vscode启动的");
                } else {
                    vscode.window.showInformationMessage("已关闭辞典服务器");
                }
            }));

            dictServerNode.children.push(new CommandItem("更新辞典服务器", async () => {
                stopDictServer();
                channel.show();
                await downloadDefaultServer(ContextHolder.get());
            }));

            const errorWarningNode = new CCDirectory(this, "错误与警告", vscode.TreeItemCollapsibleState.Collapsed);
            this.roots.push(errorWarningNode);
            errorWarningNode.children.push(new CommandItem("批量检查译文", async () => {
                await batchCheckCommand();
            }));
            errorWarningNode.children.push(new CommandItem("清除所有警告", async () => {
                clearAllWarnings();
            }));
            errorWarningNode.children.push(new CommandItem("清除常用汉字警告白名单", async () => {
                ContextHolder.setWorkspaceState('escapedCharacters', undefined);
            }));

        
            const otherCommands = new CCDirectory(this, "其他命令", vscode.TreeItemCollapsibleState.Collapsed);
            this.roots.push(otherCommands);
            otherCommands.children.push(new CommandItem("自动插入换行符", async () => {
                await batchInsertNewline();
            }));



            this.dataChanged();
        }

    }
}