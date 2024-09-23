import * as vscode from 'vscode';
import { ContextHolder, downloadFile, getWebviewContent, registerCommand, showOutputText, sleep } from './utils';
import { resolve } from 'url';
import { channel } from './dlbuild';
import { spawn } from 'child_process';
const process = require('process');
import * as fs from 'fs';
import path = require('path');
const axios = require('axios');


export async function activate(context: vscode.ExtensionContext) {
    registerCommand(context, 'Extension.dltxt.dictserver.editor.searchWord', () => {
		let editor = vscode.window.activeTextEditor;
		if (!editor || !editor.selection)
			return;
		let word = editor.document.getText(editor.selection);
        if (word.length == 0) {
            vscode.window.showInformationMessage('请选中一段内容后再查询');
            return;
        }
		dictServerSearch(context, word);
	});

    const hoverProvider = new DictServerHoverProvider(context);
    const disposable = vscode.languages.registerHoverProvider({ scheme: 'file', language: 'dltxt' }, hoverProvider);

    context.subscriptions.push(disposable);
}


async function dictServerSearch(context: vscode.ExtensionContext, word: string) {
    if (!await ensureDictServerRunning(context, true)) {
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
        'dict-server-result-viewer',
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

export async function downloadDefaultServer(context: vscode.ExtensionContext): Promise<string> {
    const config = vscode.workspace.getConfiguration("dltxt.y.searchWord.dictserver");
    let executablePath = '';
    const executableDir = path.join(context.globalStorageUri.fsPath, "dict-server");
    fs.mkdirSync(executableDir, {recursive: true});
    executablePath = path.join(executableDir, 'dict-server.exe');
    const downloadURLs = [
        'https://github.com/jsc723/moji-proxy-server/releases/download/latest/dict-server.exe', 
        'https://gitee.com/jsc723/moji-proxy-server/releases/download/latest/dict-server.exe'];
    for(const downloadURL of downloadURLs) {
        try {
            channel.appendLine(`正在从 ${downloadURL} 下载辞典服务器...`);
            await downloadFile(downloadURL, executablePath);
            break;
        } catch (err) {
            channel.appendLine(`下载失败`);
        }
    }
    channel.appendLine(`下载完成，文件保存在${executablePath}`);
    config.update('executable.path', executablePath, vscode.ConfigurationTarget.Global);
    channel.appendLine(`已将服务器文件路径加入vscode全局设置中`);
    return executablePath;
}


async function ensureDictServerRunning(context: vscode.ExtensionContext, autoStart: boolean): Promise<boolean> {
    const config = vscode.workspace.getConfiguration("dltxt.y.searchWord.dictserver");
    const baseURL = config.get('baseURL') as string;
    try {
        const health = await axios.get(resolve(baseURL, 'healthcheck'));
        channel.appendLine(`"${resolve(baseURL, 'healthcheck')}" healthcheck 成功`);
        return true;
    } catch(err) {
        if (!autoStart) {
            return false;
        }
        channel.appendLine(`"${resolve(baseURL, 'healthcheck')}" healthcheck 失败`);
    }

    channel.show();
    try {
        let executablePath = config.get('executable.path') as string;
        let executableArgs = config.get('executable.arguments') as string;
        if (!executablePath || !fs.existsSync(executablePath)) {
            executablePath = await downloadDefaultServer(context);
        }
    
        if (fs.existsSync(executablePath)) {
            channel.appendLine(`启动${executablePath}`);
            const argsList = executableArgs.split(/\s+/).filter(arg => arg.trim() !== '');
            const childProcess = spawn(executablePath, argsList);
            const Interval = 10; //10 seconds
            ContextHolder.setGlobalTempState("dictserver.pid", childProcess.pid, Interval * 1.5);
            const hdl = setInterval(() => {
                ContextHolder.setGlobalTempState("dictserver.pid", childProcess.pid, Interval * 1.5);
            }, Interval * 1000);
            

            childProcess.stdout.on('data', (data) => {
                channel.append(`dict-server: ${data}`);
            });
        
            childProcess.stderr.on('data', (data) => {
                channel.append(`dict-server: ${data}`);
            });
        
            childProcess.on('close', (code) => {
                clearInterval(hdl);
                channel.show();
                throw Error(`辞典服务器退出 ${code}`);
            });
        
            childProcess.on('error', (err) => {
                clearInterval(hdl);
                channel.show();
                throw Error(`无法启动辞典服务器 ${err}`);
            });

            const maxAttempts = 6;
    
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


async function dictServerSearchLite(context: vscode.ExtensionContext, word: string): Promise<any> {
    if (!await ensureDictServerRunning(context, false)) {
        return undefined;
    }
    const config = vscode.workspace.getConfiguration("dltxt.y.searchWord.dictserver");
    const baseURL = config.get('baseURL') as string;
    const maxLen = 1;
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

    return response.data;
}

export function stopDictServer(): boolean {
    const pid = ContextHolder.getGlobalTempState("dictserver.pid");
    if (!pid) {
        return false;
    }
    try {
        process.kill(pid, 'SIGTERM');
    } catch(e) {
        return false;
    }
    return true;
}


export class DictServerHoverProvider implements vscode.HoverProvider {

    context: vscode.ExtensionContext;
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const config = vscode.workspace.getConfiguration("dltxt.y.searchWord.dictserver.hover");
        const show = config.get('show') as boolean;
        if (!show) {
            return undefined;
        }

        // Check if there is an active selection
        const activeSelection = vscode.window.activeTextEditor?.selection;

        if (!activeSelection || activeSelection.isEmpty) {
            // No selection, return undefined to indicate no hover information
            return undefined;
        }

        // Get the selected text
        const selectedText = document.getText(activeSelection);

        const hover = new vscode.Hover(new vscode.MarkdownString(selectedText));

        const resultPromise = dictServerSearchLite(this.context, selectedText);

        return resultPromise.then((result) => {
            if (!result || !result.words || result.words.length < 1) {
                return undefined;
            }
            const hoverText = getWordMarkdown(result.words[0]);
            const hover = new vscode.Hover(new vscode.MarkdownString(hoverText));
            return hover;
        }).catch((err) => {
            return undefined;
        })

    }
}

function getWordMarkdown(word: any) {
    let res = `### ${word.spell}\n\n${word.excerpt}\n\n`;

    if (word.subDetails) {
        let idx = 1;
        for (let sub of word.subDetails) {
            res += `**(${idx++})** ${sub.title}\n\n`;
        }
    }
    return res;
}