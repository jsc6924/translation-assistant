// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as motion from './motion';
import { setCursorAndScroll, VSCodeContext, registerCommand, ContextHolder, compareVersions } from './utils';
import {
	formatter, copyOriginalToTranslation,
	repeatFirstChar
} from "./formatter";
import { batchConvertFilesEncoding, detectFileEncoding } from './encoding';
import * as dlbuild from './dlbuild';
import { trdb_view, cc_view } from './treeview';
import { spellCheck, clearSpellCheck } from './spellcheck';
import { updateErrorDecorations, updateNewlineDecorations } from './error-check';
import * as mode from './mode';
import * as clipboard from './clipboard';
import * as trdb from './translation-db';
import * as simpletm from './simpletm';
import * as singleline from './singleline';
import * as auto_format from './auto-format';
import * as fs from 'fs';
import * as dictserver from './dictserver';
import * as parser from './parser';
import * as batch from './batch';
import * as crossref from './crossref';
import * as error_check from './error-check';
import { getRegex } from './parser';



/*
(;\\[[a-z0-9]+\\])|((☆|●)[a-z0-9]+(☆|●))|(<\\d+>(?!//))|(//.*\n)
*/
//？！：；…—
//https://blog.csdn.net/yuan892173701/article/details/8731490
//https://gist.github.com/ryanmcgrath/982242
// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	ContextHolder.set(context);
	parser.activate(context);

	if (!fs.existsSync(context.globalStorageUri.fsPath)) {
		fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
	}

	let timeout: NodeJS.Timer | undefined = undefined;

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

	simpletm.activate(context);

	vscode.window.onDidChangeActiveTextEditor(editor => {
		activeEditor = editor;
		if (editor) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		let activeEditor = vscode.window.activeTextEditor;
		const config = vscode.workspace.getConfiguration("dltxt.core");
		const noStrict = (event.reason === vscode.TextDocumentChangeReason.Undo || 
				event.reason === vscode.TextDocumentChangeReason.Redo);
		if (config.get<boolean>('strictEditing') && !noStrict) {
			for (const change of event.contentChanges) {
				const startLine = change.range.start.line;
				const endLine = change.range.end.line;
				if (startLine !== endLine || change.text.indexOf('\n') !== -1) {
					vscode.commands.executeCommand('undo');
					vscode.window.showWarningMessage('不可删除或插入行。您可以在设置中查找dltxt.core.strictEditing关闭此功能。');
					return;
				}
				for (let line = startLine; line <= endLine; line++) {
					const lineText = event.document.lineAt(line).text;
					if (parser.DocumentParser.isUneditable(lineText)) {
						vscode.commands.executeCommand('undo');
						vscode.window.showWarningMessage('原文不可编辑。您可以在设置中查找dltxt.core.strictEditing关闭此功能。');
						return;
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
	
	registerCommand(context, 'Extension.dltxt.detectEncoding', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;
		const encoding = await detectFileEncoding(editor.document.uri.fsPath);
		vscode.window.showInformationMessage(`encoding: ${encoding}`);
	});

	dlbuild.activate(context);
	singleline.activate(context);
	clipboard.activate(context);

	const trdb_tree = new trdb_view.TRDBTreeView(context, trdb.TRDBIndex);
	trdb.activate(context, trdb_tree);
	vscode.window.registerTreeDataProvider('dltxt-trdb', trdb_tree);
	const cc_tree = new cc_view.CCTreeView(context);
	vscode.window.registerTreeDataProvider('dltxt-configs-commands', cc_tree);

	auto_format.activate(context);
	dictserver.activate(context);
	batch.activate(context);
	crossref.activate(context);
	error_check.activate(context);
	
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

	migration(context);

}

// this method is called when your extension is deactivated
export function deactivate() { }

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

