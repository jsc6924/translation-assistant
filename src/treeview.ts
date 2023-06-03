import * as vscode from 'vscode'
import * as fs from 'fs';
import * as path from 'path';

// lets put all in a cwt namespace
export namespace cwt
{
    class CustomItem extends vscode.TreeItem {
        constructor(label: string) {
            super(label, vscode.TreeItemCollapsibleState.None);
        }
    }
    
    // 1. we'll export this class and use it in our extension later
    // 2. we need to implement vscode.TreeDataProvider
    export class tree_view implements vscode.TreeDataProvider<CustomItem>
    {
        getTreeItem(element: CustomItem): vscode.TreeItem {
            return element;
        }
    
        getChildren(element?: CustomItem): Thenable<CustomItem[]> {
            // Return the child items of the root or element
            const items: CustomItem[] = [
                new CustomItem('Item 1'),
                new CustomItem('Item 2'),
                new CustomItem('Item 3')
            ];
            return Promise.resolve(items);
        }
    }
}