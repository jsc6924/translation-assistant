// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as motion from './motion';
import { setCursorAndScroll, VSCodeContext, registerCommand, ContextHolder, compareVersions, countInString } from './utils';
import {
	formatter, copyOriginalToTranslation,
	repeatFirstChar
} from "./formatter";
import { batchConvertFilesEncoding, detectFileEncoding } from './encoding';
import * as dlbuild from './dlbuild';
import { trdb_view } from './treeview';
import { cc_view } from './command-center';
import { spellCheck, clearSpellCheck } from './spellcheck';
import { updateErrorDecorations, updateNewlineDecorations } from './error-check';
import * as mode from './mode';
import * as clipboard from './clipboard';
import * as trdb from './translation-db';
import * as simpletm from './simpletm';
import * as singleline from './singleline';
import * as auto_format from './auto-format';
import * as fs from 'fs';
import * as path from 'path';
import * as mojidict from './mojidict';
import * as parser from './parser';
import * as batch from './batch';
import * as crossref from './crossref';
import * as error_check from './error-check';
import * as lsp from './lspclient';
import * as word_count from './word-count';
import { ensureNodeJiebaLoaded } from './nodejieba';

const startupChannel = vscode.window.createOutputChannel('DLTXT Startup');
let startupLogFilePath: string | undefined;

function formatStartupError(error: unknown): string {
	if (error instanceof Error) {
		return error.stack || error.message;
	}
	return String(error);
}

function appendStartupLog(line: string) {
	startupChannel.appendLine(line);
	console.log(line);
	if (startupLogFilePath) {
		fs.appendFileSync(startupLogFilePath, `${line}\n`, 'utf8');
	}
}

function logStartup(message: string, error?: unknown) {
	const line = `[${new Date().toISOString()}] ${message}`;
	appendStartupLog(line);
	if (error !== undefined) {
		const details = formatStartupError(error);
		appendStartupLog(details);
		console.error(details);
	}
}

function initializeStartupLog(context: vscode.ExtensionContext) {
	if (!fs.existsSync(context.logUri.fsPath)) {
		fs.mkdirSync(context.logUri.fsPath, { recursive: true });
	}
	startupLogFilePath = path.join(context.logUri.fsPath, 'startup.log');
	logStartup(`startup log file: ${startupLogFilePath}`);
}

process.on('uncaughtException', (error) => {
	logStartup('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
	logStartup('unhandledRejection', reason);
});



/*
(;\\[[a-z0-9]+\\])|((☆|●)[a-z0-9]+(☆|●))|(<\\d+>(?!//))|(//.*\n)
*/
//？！：；…—
//https://blog.csdn.net/yuan892173701/article/details/8731490
//https://gist.github.com/ryanmcgrath/982242
// this method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
	let stage = 'startup';
	initializeStartupLog(context);
	logStartup('activate begin');

	try {
		stage = 'set extension context';
		ContextHolder.set(context);

		stage = 'activate lsp';
		logStartup(stage);
		await lsp.activate(context);

		stage = 'activate parser and word count';
		logStartup(stage);
		parser.activate(context);
		word_count.activate(context);

		stage = 'prepare global storage';
		logStartup(stage);
		if (!fs.existsSync(context.globalStorageUri.fsPath)) {
			fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
		}

		let timeout: NodeJS.Timer | undefined = undefined;

		stage = 'register commands';
		logStartup(stage);
		mode.setMode(mode.Mode.Normal);
		registerCommand(context, "Extension.dltxt.setMode", (args) => {
			mode.setModeStr(args.arg);
		});
		registerCommand(context, "Extension.dltxt.toggleMode", () => {
			const m = VSCodeContext.get('dltxt.mode') as string;
			mode.setModeStr(mode.getNextMode(m));
		});

		registerCommand(context, 'Extension.dltxt.executeFunction', async (args) => {
			const callback = args.callback;
			if (callback) callback();
		});

		registerCommand(context, 'Extension.dltxt.copyToClipboard', (arg) => {
        vscode.env.clipboard.writeText(arg.text).then(
			() => {
				vscode.window.showInformationMessage(`已复制`);
			},
			(reason) => {
				vscode.window.showInformationMessage(`复制失败: ${reason}`);
			}
		)
    });

		let activeEditor = vscode.window.activeTextEditor;

		function triggerUpdateDecorations() {
			if (timeout) {
				clearTimeout(timeout);
				timeout = undefined;
			}
			timeout = setTimeout(() => {
				updateNewlineDecorations();
				updateErrorDecorations();
				simpletm.updateKeywordDecorations();
			}, 200);
		}

		if (activeEditor) {
			triggerUpdateDecorations();
		}

		registerCommand(context, 'Extension.dltxt.internal.updateDecorations', () => {
			triggerUpdateDecorations();
		});

		stage = 'activate simpletm';
		logStartup(stage);
		simpletm.activate(context);

		stage = 'register editor listeners';
		logStartup(stage);
		vscode.window.onDidChangeActiveTextEditor(editor => {
			activeEditor = editor;
			if (editor) {
				triggerUpdateDecorations();
			}
		}, null, context.subscriptions);

		vscode.workspace.onDidChangeTextDocument(event => {
		let activeEditor = vscode.window.activeTextEditor;
		const document = event.document;
		const config = vscode.workspace.getConfiguration("dltxt.core");
		const noStrict = (event.reason === vscode.TextDocumentChangeReason.Undo || 
				event.reason === vscode.TextDocumentChangeReason.Redo);
		// Skip non-file documents (terminal, output, etc.) and non-.txt files
		if (event.document.uri.scheme !== 'file' 
			|| !event.document.uri.fsPath.endsWith('.txt')
		    || event.document.uri.fsPath.includes('CMakeLists.txt')) {
			return;
		}

		if (config.get<boolean>('strictEditing') && !noStrict && !tempDisableStrictEditing) {
			for (const change of event.contentChanges) {
				const startLine = change.range.start.line;
				const endLine = change.range.end.line;
				const originalLineCount = endLine - startLine + 1;
				const newLineCount = countInString(change.text, '\n') + 1;
				if (originalLineCount !== newLineCount) {
					vscode.commands.executeCommand('undo');
					vscode.window.showWarningMessage(`不可删除或插入行。您可以在设置中查找dltxt.core.strictEditing关闭此功能。${change.range.start.line} ${change.range.end.line}`, '临时关闭').then(selection => {
						if (selection === '临时关闭') {
							tempDisableStrictEditing = true;
						}
					});
					return;
				}
				if (newLineCount <= 2) {
					for (let line = startLine; line <= endLine; line++) {
						const lineText = event.document.lineAt(line).text;
						if (parser.DocumentParser.isUneditable(lineText)) {
							vscode.commands.executeCommand('undo');
							vscode.window.showWarningMessage(`原文不可编辑。您可以在设置中查找dltxt.core.strictEditing关闭此功能。${change.range.start.line}`, '临时关闭').then(selection => {
								if (selection === '临时关闭') {
									tempDisableStrictEditing = true;
								}
							});
							return;
						}
					}
				}
			}
		}
		if (activeEditor && event.document === activeEditor.document) {
			triggerUpdateDecorations();
		}
		}, null, context.subscriptions);

		registerCommand(context, 'Extension.dltxt.copy_original', () => {
		const editor = vscode.window.activeTextEditor;
		const document = editor?.document;
		if (!editor || !document) {
			vscode.window.showErrorMessage('请先选中需要更改的双行文本');
			return;
		}
		editor.edit(editBuilder => {
			copyOriginalToTranslation(context, document, editBuilder);
		});
		});

		stage = 'activate motion';
		logStartup(stage);
		motion.activate(context);

		const repeatFirstFunc = () => {
		let editor = vscode.window.activeTextEditor;
		let document = editor?.document;
		if (!editor || !document) 
			return;
		editor.edit(editBuilder => {
			repeatFirstChar(context, editor as vscode.TextEditor, editBuilder);
		})
		setCursorAndScroll(editor, 0, editor.selection.start.character + 2, false);
		};
		registerCommand(context, 'Extension.dltxt.repeatFirst', repeatFirstFunc);
	
		registerCommand(context, 'Extension.dltxt.convertToEncoding', batchConvertFilesEncoding);

		registerCommand(context, 'Extension.dltxt.spellCheck', () => {
			spellCheck(context);
		});

		registerCommand(context, 'Extension.dltxt.spellCheckClear', () => {
			clearSpellCheck();
		});

		registerCommand(context, 'Extension.dltxt.customWriteKey', (args) => {
			const k = args.arg1;
			const s = clipboard.ClipBoardManager.get(context, k);
			motion.editorWriteString(s);
		});

		registerCommand(context, "Extension.dltxt.writeNewlineToken", () => {
			const config = vscode.workspace.getConfiguration("dltxt");
			const token = config.get<string>("nestedLine.token") || "\\r\\n";
			motion.editorWriteString(token);
		})
	
		registerCommand(context, 'Extension.dltxt.detectEncoding', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) return;
			const encoding = await detectFileEncoding(editor.document.uri.fsPath);
			vscode.window.showInformationMessage(`encoding: ${encoding}`);
		});

		stage = 'activate feature modules';
		logStartup(stage);
		dlbuild.activate(context);
		singleline.activate(context);
		clipboard.activate(context);

		const trdb_tree = new trdb_view.TRDBTreeView(context, trdb.TRDBIndex);
		trdb.activate(context, trdb_tree);
		vscode.window.registerTreeDataProvider('dltxt-trdb', trdb_tree);
		const cc_tree = new cc_view.CCTreeView(context);
		vscode.window.registerTreeDataProvider('dltxt-configs-commands', cc_tree);

		auto_format.activate(context);
		mojidict.activate(context);
		batch.activate(context);
		crossref.activate(context);
		error_check.activate(context);
	
		stage = 'register formatting provider';
		logStartup(stage);
		vscode.languages.registerDocumentFormattingEditProvider('dltxt', {
			provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
				try {
					return formatter(context, document);
				} catch (e) {
					vscode.window.showErrorMessage(`${e}`);
					return [];
				}
			}
		});

		stage = 'migration';
		logStartup(stage);
		migration(context);

		stage = 'load nodejieba';
		logStartup(stage);
		ensureNodeJiebaLoaded();

		logStartup('activate completed');
	} catch (error) {
		logStartup(`activate failed during ${stage}`, error);
		startupChannel.show(true);
		void vscode.window.showErrorMessage(`DLTXT 启动失败：${String(error)}`, '打开启动日志').then((selection) => {
			if (selection === '打开启动日志' && startupLogFilePath) {
				return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(startupLogFilePath));
			}
			return undefined;
		});
		throw error;
	}

}

var tempDisableStrictEditing = false;

// this method is called when your extension is deactivated
export async function deactivate() {
	await lsp.stopLanguageClient();
}

async function migration(context: vscode.ExtensionContext) {
	let oldVersion = ContextHolder.getGlobalState('dltxt.version') as string;
	if (!oldVersion) {
		oldVersion = "2.34.99";
	}
	const curVersion = vscode.extensions.getExtension('jsc723.translateassistant')?.packageJSON.version;
	if (!curVersion || oldVersion.length < 1 || curVersion.length < 1) {
		return;
	}
	
	if (compareVersions(oldVersion, "3.0.0") < 0) {
		simpletm.migration(context);
	}

	if(compareVersions(oldVersion, "3.18.0") < 0) {
		const baiduConfig = vscode.workspace.getConfiguration("dltxt.z.api.baidu");
		const accessKey = baiduConfig.get("AccessKey");
		const secretKey = baiduConfig.get("SecretKey");
		if (accessKey || secretKey) {
			ContextHolder.setGlobalState("dltxt.config.baidu.accesskey", accessKey);
			ContextHolder.setGlobalState("dltxt.config.baidu.secretkey", secretKey);
			baiduConfig.update("AccessKey", undefined, vscode.ConfigurationTarget.Global);
			baiduConfig.update("SecretKey", undefined, vscode.ConfigurationTarget.Global);
		}
	}

	ContextHolder.setGlobalState('dltxt.version', curVersion);
	
}

