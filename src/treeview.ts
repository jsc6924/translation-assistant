import * as vscode from 'vscode'

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


    class ValueItem extends vscode.TreeItem {
        value: string = '';
        contextValue = 'value-item';
        constructor(label: string, value: string) {
            super(label, vscode.TreeItemCollapsibleState.None);
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
        private m_onDidChangeTreeData: vscode.EventEmitter<CustomItem | undefined> = new vscode.EventEmitter<CustomItem | undefined>();
        // and vscode will access the event by using a readonly onDidChangeTreeData (this member has to be named like here, otherwise vscode doesnt update our treeview.
        readonly onDidChangeTreeData ? : vscode.Event<CustomItem | undefined> = this.m_onDidChangeTreeData.event;

        items: ValueItem[] = [];

        constructor() {
            this.refresh();
        }
        getTreeItem(item: ValueItem): vscode.TreeItem {
            return item;
        }
    
        getChildren(element?: ValueItem): Thenable<ValueItem[]> {
            return Promise.resolve(this.items);
        }

        refresh() {
            const config = vscode.workspace.getConfiguration('dltxt');
            const prefix = 'motion.customInsertString';
            this.items = []
            for (let i = 1; i <= 6; i++) {
                const k = prefix + String(i);
                const v = config.get(k) as string;
                this.items.push(new ValueItem(`${i}: ${v}`, v));
            }
            this.m_onDidChangeTreeData.fire(undefined);
        }
    }
}