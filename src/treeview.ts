import * as vscode from 'vscode'

// lets put all in a cwt namespace
export namespace dltxt
{
    class CustomItem extends vscode.TreeItem {
        raw: string = '';
        value: string = '';
        constructor(label: string, value: string) {
            super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
            if (!value) {
                this.label = label;
            }
            this.raw = label;
            this.value = value;
        }
    }
    
    // 1. we'll export this class and use it in our extension later
    // 2. we need to implement vscode.TreeDataProvider
    export class TreeView implements vscode.TreeDataProvider<CustomItem>
    {
        // with the vscode.EventEmitter we can refresh our  tree view
        private m_onDidChangeTreeData: vscode.EventEmitter<CustomItem | undefined> = new vscode.EventEmitter<CustomItem | undefined>();
        // and vscode will access the event by using a readonly onDidChangeTreeData (this member has to be named like here, otherwise vscode doesnt update our treeview.
        readonly onDidChangeTreeData ? : vscode.Event<CustomItem | undefined> = this.m_onDidChangeTreeData.event;

        items: CustomItem[] = [];
        game = '';

        // we register two commands for vscode, item clicked (we'll implement later) and the refresh button. 
        public constructor()  {
            vscode.commands.registerCommand('Extension.dltxt.treeview.onItemClicked', r => this.onItemClicked(r));
        }

        getTreeItem(item: CustomItem): vscode.TreeItem {
            let title = item.label ? item.label.toString() : "";
            let result = new vscode.TreeItem(title, item.collapsibleState);
            // here we add our command which executes our memberfunction
            result.command = { command: 'Extension.dltxt.treeview.onItemClicked', title : title, arguments: [item] };
            return result;
        }
    
        getChildren(element?: CustomItem): Thenable<CustomItem[]> {
            if (!this.game) {
                return Promise.resolve([new CustomItem('未连接SimpleTM数据库', '')]);
            }
            return Promise.resolve(this.items);
        }

        // this is called when we click an item
        public onItemClicked(item: CustomItem) {
            vscode.commands.executeCommand('Extension.dltxt.dict_update', item.raw)
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
}