import * as vscode from 'vscode';
import { registerCommand, showOutputText } from './utils';
import { resolve } from 'url';
const axios = require('axios');


export async function activate(context: vscode.ExtensionContext) {
    registerCommand(context, 'Extension.dltxt.dictserver.editor.searchWord', () => {
		let editor = vscode.window.activeTextEditor;
		if (!editor || !editor.selection)
			return;
		let word = editor.document.getText(editor.selection);
		dictServerSearch(word);
	});
}

function getWebviewContent(jsonString: string): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    white-space: pre-wrap;
                }
            </style>
        </head>
        <body>
            <pre>${jsonString}</pre>
        </body>
        </html>`;
}

async function dictServerSearch(word: string) {
    const config = vscode.workspace.getConfiguration("dltxt.y.searchWord.dictserver");
    const baseURL = config.get('baseURL') as string;
    const maxLen = config.get('displayCount') as number;
    console.log(baseURL)
    let response = await axios.post(resolve(baseURL, 'search'), {
        query: word
    });

    //console.log(response.data)

    let objectIds = [];
    for (let item of response.data['result']['word']['searchResult']) {
        if (objectIds.length < maxLen) {
            objectIds.push(item['targetId'])
        }
    }

    console.log(objectIds)

    response = await axios.post(resolve(baseURL, 'details'), {
        'objectIds': objectIds
    });

    //console.log(response.data)

    let jsonData = JSON.stringify(response.data, null, 2);
    // Create or reveal the Webview panel
    const panel = vscode.window.createWebviewPanel(
        'jsonViewer',
        `"${word}"的搜索结果`,
        vscode.ViewColumn.One,
        {}
    );

    // Set the HTML content
    panel.webview.html = getWebviewContent(jsonData);
    panel.reveal();
}