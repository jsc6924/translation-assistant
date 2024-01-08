import * as vscode from 'vscode';
import { downloadFile, registerCommand, showOutputText, sleep } from './utils';
import { resolve } from 'url';
import { channel } from './dlbuild';
import { spawn } from 'child_process';
import * as fs from 'fs';
import path = require('path');
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

function getWebviewContent(scritpUri: vscode.Uri, cssUri: vscode.Uri, jsonString: string): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" type="text/css" href="${cssUri}">
        </head>
        <body>
            <script src="${scritpUri}"></script>
            <div id="view-root"></div>
            <pre id='raw-data' hidden>${jsonString}</pre> 
        </body>
        </html>`;
}

async function dictServerSearch(context: vscode.ExtensionContext, word: string) {
    if (!await ensureDictServerRunning(context)) {
        return;
    }
    const config = vscode.workspace.getConfiguration("dltxt.y.searchWord.dictserver");
    const baseURL = config.get('baseURL') as string;
    const maxLen = config.get('displayCount') as number;
    console.log(baseURL)
    let response = await axios.post(resolve(baseURL, 'search'), {
        query: word
    });

    //console.log(response.data)

    let objectIds = [];

    try {
        for (let item of response.data['result']['word']['searchResult']) {
            if (objectIds.length < maxLen) {
                objectIds.push(item['targetId'])
            }
        }
    
        if (objectIds.length > 0) {
            response = await axios.post(resolve(baseURL, 'details'), {
                'objectIds': objectIds
            });
        } else {
            response = { data: { words: [] } }
        }
        
    } catch(err) {
        channel.appendLine(`查询时发生错误${err}`);
        response = { data: { words: [] } };
    }

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
    const cssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'dictserver.css'));

    // Set the HTML content
    panel.webview.html = getWebviewContent(scriptUri, cssUri, jsonData);
    panel.reveal();
}


async function ensureDictServerRunning(context: vscode.ExtensionContext): Promise<boolean> {
    const config = vscode.workspace.getConfiguration("dltxt.y.searchWord.dictserver");
    const baseURL = config.get('baseURL') as string;
    try {
        const health = await axios.get(resolve(baseURL, 'healthcheck'));
        channel.appendLine(`"${resolve(baseURL, 'healthcheck')}" healthcheck 成功`);
        return true;
    } catch(err) {
        channel.appendLine(`"${resolve(baseURL, 'healthcheck')}" healthcheck 失败`);
    }

    channel.show();
    try {
        let executablePath = config.get('executable.path') as string;
        let executableArgs = config.get('executable.arguments') as string;
        if (!fs.existsSync(executablePath)) {
            const executableDir = path.join(context.globalStoragePath, "dict-server");
            fs.mkdirSync(executableDir, {recursive: true});
            executablePath = path.join(executableDir, 'dict-server.exe');
            const downloadURL = 'https://github.com/jsc723/moji-proxy-server/releases/download/latest/dict-server.exe';
            channel.appendLine(`正在从 ${downloadURL} 下载辞典服务器...`);
            await downloadFile(downloadURL, executablePath);
            channel.appendLine(`下载完成，文件保存在${executablePath}`);
            config.update('executable.path', executablePath, vscode.ConfigurationTarget.Global);
            channel.appendLine(`已将服务器文件路径加入vscode全局设置中`);
        }
    
        if (fs.existsSync(executablePath)) {
            channel.appendLine(`启动${executablePath}`);
            const argsList = executableArgs.split(/\s+/).filter(arg => arg.trim() !== '');
            const childProcess = spawn(executablePath, argsList);

            childProcess.stdout.on('data', (data) => {
                channel.append(`dict-server: ${data}`);
            });
        
            childProcess.stderr.on('data', (data) => {
                channel.append(`dict-server: ${data}`);
            });
        
            childProcess.on('close', (code) => {
                channel.show();
                throw Error(`辞典服务器退出 ${code}`);
            });
        
            childProcess.on('error', (err) => {
                channel.show();
                throw Error(`无法启动辞典服务器 ${err}`);
            });

            const maxAttempts = 5;
    
            for(let attempt = 0, sleepTime = 2000; attempt < maxAttempts; attempt++, sleepTime *= 1.5) {
                try {
                    await sleep(Math.min(8000, sleepTime));
                    const health = await axios.get(resolve(baseURL, 'healthcheck'));
                    channel.appendLine(`"${resolve(baseURL, 'healthcheck')}" healthcheck 成功`);
                    return true;
                } catch(err) {
                    channel.appendLine(`"${resolve(baseURL, 'healthcheck')}" healthcheck 失败`);
                }
            }
            throw Error(`healthcheck${maxAttempts}次尝试失败，放弃尝试`);
        }
    } catch(err) {
        channel.appendLine(`${err}`)
    }
    
    channel.appendLine(`无法启动辞典服务器，请检查配置，或手动启动`);

    return false;
}