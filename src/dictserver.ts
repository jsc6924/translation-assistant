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
		dictServerSearch(context, word);
	});
}

function getWebviewContent(scritpUri: vscode.Uri, jsonString: string): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    white-space: pre-wrap;
                }
            </style>
        </head>
        <body>
            <script src="${scritpUri}"></script>
            <div id="view-root"></div>
            <pre id='raw-data' hidden>${jsonString}</pre> 
        </body>
        </html>`;
}

async function dictServerSearch(context: vscode.ExtensionContext, word: string) {
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
        {
            // Enable scripts in the webview
            enableScripts: true
        }
    );

    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'dictserver.js'));

    // Set the HTML content
    panel.webview.html = getWebviewContent(scriptUri, jsonData);
    panel.reveal();
}