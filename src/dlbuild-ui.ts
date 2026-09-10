import * as vscode from 'vscode';
import * as path from 'path';
import { registerCommand } from './utils';
import * as dlbuild from './dlbuild';

const VIEW_TYPE = 'dltxt-dlbuild-ui';
const PANEL_TITLE = 'DLTXT 构建器';

type WebviewMessage =
    | { type: 'validateConfig'; requestId: string; activeTab: string; config: unknown }
    | { type: 'runOperation'; requestId: string; activeTab: string; config: unknown }
    | { type: 'openDirectoryDialog'; requestId: string }
    | { type: 'openFileDialog'; requestId: string };

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
    registerCommand(context, 'Extension.dltxt.dlbuild.ui', () => {
        const rootPath = getRootPath();
        if (!rootPath) {
            vscode.window.showErrorMessage('请先打开一个工作区目录');
            return;
        }
        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.Active);
            return;
        }
        const panel = createPanel(context);
        currentPanel = panel;
        panel.reveal(vscode.ViewColumn.Active);
        renderPanel(panel, context, rootPath);
    });
}

function getRootPath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return undefined; }
    return folders[0].uri.fsPath;
}

function createPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        PANEL_TITLE,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'src', 'webview'),
                vscode.Uri.joinPath(context.extensionUri, 'media', 'webview'),
            ],
        },
    );
    panel.onDidDispose(() => {
        if (currentPanel === panel) { currentPanel = undefined; }
    });
    return panel;
}

function renderPanel(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, rootPath: string) {
    panel.webview.html = getHtml(panel.webview, context, rootPath);
    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
        try {
            if (msg.type === 'validateConfig') {
                const result = validateConfig(msg.activeTab, msg.config);
                await panel.webview.postMessage({ type: 'configValidated', requestId: msg.requestId, ...result });
                return;
            }
            if (msg.type === 'runOperation') {
                const result = await runOperation(context, msg.activeTab, msg.config);
                await panel.webview.postMessage({ type: 'operationDone', requestId: msg.requestId, ...result });
                return;
            }
            if (msg.type === 'openDirectoryDialog') {
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
                const fsPath = uris && uris.length > 0 ? uris[0].fsPath : '';
                await panel.webview.postMessage({ type: 'dialogResult', requestId: msg.requestId, fsPath });
                return;
            }
            if (msg.type === 'openFileDialog') {
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false });
                const fsPath = uris && uris.length > 0 ? uris[0].fsPath : '';
                await panel.webview.postMessage({ type: 'dialogResult', requestId: msg.requestId, fsPath });
                return;
            }
        } catch (error) {
            await panel.webview.postMessage({
                type: 'requestError',
                requestId: msg.requestId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}

function validateConfig(activeTab: string, config: unknown): { ok: boolean; error?: string } {
    if (!config || typeof config !== 'object') {
        return { ok: false, error: '配置为空' };
    }
    const c = config as any;
    try {
        switch (activeTab) {
            case 'extract': return validateExtract(c);
            case 'pack': return validatePack(c);
            case 'concat': return validatePathConfig(c, 'concat');
            case 'merge': return validateMerge(c);
            case 'wordcount': return validatePathConfig(c, 'wordcount');
            case 'transform': return validateTransform(c);
            default: return { ok: false, error: `未知操作: ${activeTab}` };
        }
    } catch (e) {
        return { ok: false, error: `校验异常: ${e}` };
    }
}

function validateExtract(c: any): { ok: boolean; error?: string } {
    if (!c.input?.path) { return { ok: false, error: '提取输入路径不能为空' }; }
    if (!c.output?.path) { return { ok: false, error: '提取输出路径不能为空' }; }
    if (!c.input.items || !Array.isArray(c.input.items) || c.input.items.length === 0) {
        return { ok: false, error: '至少需要 1 个提取项' };
    }
    if (!(c.input.digits > 0)) { return { ok: false, error: '标签数字位数必须为正整数' }; }
    for (let i = 0; i < c.input.items.length; i++) {
        const it = c.input.items[i];
        if (!it.capture) { return { ok: false, error: `第 ${i + 1} 个提取项的正则不能为空` }; }
        try { new RegExp(it.capture); } catch (e) {
            return { ok: false, error: `第 ${i + 1} 个提取项正则无效: ${e}` };
        }
        if (!(it.group >= 1)) { return { ok: false, error: `第 ${i + 1} 个提取项 group 需 >= 1` }; }
    }
    return { ok: true };
}

function validatePack(c: any): { ok: boolean; error?: string } {
    if (!c.pack) { return { ok: false, error: '缺少 pack 配置' }; }
    if (!c.pack.input?.path) { return { ok: false, error: '打包输入路径不能为空' }; }
    if (!c.pack.output?.path) { return { ok: false, error: '打包输出路径不能为空' }; }
    return { ok: true };
}

function validatePathConfig(c: any, key: string): { ok: boolean; error?: string } {
    if (!c.input?.path) { return { ok: false, error: `${key} 输入路径不能为空` }; }
    if (c.output && !c.output.path) { return { ok: false, error: `${key} 输出路径不能为空` }; }
    return { ok: true };
}

function validateMerge(c: any): { ok: boolean; error?: string } {
    if (!c.input1?.path) { return { ok: false, error: '合并输入 1 路径不能为空' }; }
    if (!c.input2?.path) { return { ok: false, error: '合并输入 2 路径不能为空' }; }
    if (!c.output?.path) { return { ok: false, error: '合并输出路径不能为空' }; }
    return { ok: true };
}

function validateTransform(c: any): { ok: boolean; error?: string } {
    if (!c.input?.path) { return { ok: false, error: '转换输入路径不能为空' }; }
    if (c.output && !c.output.path) { return { ok: false, error: '转换输出路径不能为空' }; }
    if (!['line', 'block'].includes(c.mode)) { return { ok: false, error: '转换模式需为 line 或 block' }; }
    if (c.operations && !Array.isArray(c.operations)) { return { ok: false, error: 'operations 必须为数组' }; }
    return { ok: true };
}

async function runOperation(context: vscode.ExtensionContext, activeTab: string, config: unknown): Promise<{ ok: boolean; message: string; total?: number; success?: number }> {
    const rootPath = getRootPath();
    if (!rootPath) { return { ok: false, message: '未打开工作区' }; }
    const v = validateConfig(activeTab, config);
    if (!v.ok) { return { ok: false, message: v.error || '配置无效' }; }
    const c = config as any;
    try {
        switch (activeTab) {
            case 'extract': {
                const res = await dlbuild.extractWithConfig(context, c as dlbuild.ExtractConfig);
                return { ok: true, message: `提取完成：共 ${res.total} 个文件，成功 ${res.success} 个文件`, total: res.total, success: res.success };
            }
            case 'pack': {
                const res = await dlbuild.packWithConfig(context, c.pack, c.extractExt || '');
                return { ok: true, message: `替换完成：共 ${res.total} 个文件，成功 ${res.success} 个文件`, total: res.total, success: res.success };
            }
            case 'concat': {
                const res = await dlbuild.concatWithConfig(context, c as dlbuild.ConcatConfig);
                return { ok: true, message: `连接完成：共 ${res.total} 个文件，成功 ${res.success} 个，输出 ${res.numFolders} 个文件`, total: res.total, success: res.success };
            }
            case 'merge': {
                const res = await dlbuild.mergeWithConfig(context, c as dlbuild.MergeConfig);
                return { ok: true, message: `合并完成：共 ${res.total} 个文件，成功 ${res.success} 个文件`, total: res.total, success: res.success };
            }
            case 'wordcount': {
                const res = await dlbuild.wordcountWithConfig(context, c as dlbuild.WordcountConfig);
                return { ok: true, message: `字数统计：共 ${res.total} 个文件，原文 ${res.jcount} 字，译文 ${res.ccount} 字`, total: res.total };
            }
            case 'transform': {
                const res = await dlbuild.transformWithConfig(context, c as dlbuild.TransformConfig);
                return { ok: true, message: `批量处理：共 ${res.total} 个文件`, total: res.total };
            }
            default:
                return { ok: false, message: `未知操作: ${activeTab}` };
        }
    } catch (e) {
        return { ok: false, message: `执行失败: ${e instanceof Error ? e.message : e}` };
    }
}

function getHtml(webview: vscode.Webview, context: vscode.ExtensionContext, rootPath: string): string {
    const sharedScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'react-shared-vendor.js'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'dlbuild.js'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'dlbuild-react.css'));
    const initialState = JSON.stringify({ rootPath }).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="view-root"></div>
  <script id="initial-state" type="application/json">${initialState}</script>
  <script src="${sharedScriptUri}"></script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}
