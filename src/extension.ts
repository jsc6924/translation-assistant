// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as motion from './motion';
import { setCursorAndScroll, getOrCreateDiagnosticCollection, VSCodeContext, registerCommand,
	ContextHolder } from './utils';
import {
	formatter, copyOriginalToTranslation,
	repeatFirstChar, getRegex
} from "./formatter";
import { batchConvertFilesEncoding } from './encoding';
import { channel, extract, pack } from './dlbuild';
import { trdb_view } from './treeview';
import { spellCheck, clearSpellCheck } from './spellcheck';
import { updateErrorDecorations } from './error-check';
import * as mode from './mode';
import * as clipboard from './clipboard';
import * as trdb from './translation-db';
import * as simpletm from './simpletm';
import * as singleline from './singleline';
import * as auto_format from './auto-format';


/*
(;\\[[a-z0-9]+\\])|((☆|●)[a-z0-9]+(☆|●))|(<\\d+>(?!//))|(//.*\n)
*/
//？！：；…—
//https://blog.csdn.net/yuan892173701/article/details/8731490
//https://gist.github.com/ryanmcgrath/982242
// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	ContextHolder.set(context);

	let timeout: NodeJS.Timer | undefined = undefined;

	mode.setMode(mode.Mode.Normal);
	registerCommand(context, "Extension.dltxt.setMode", (args) => {
		mode.setModeStr(args.arg);
	});
	registerCommand(context, "Extension.dltxt.toggleMode", () => {
		const m = VSCodeContext.get('dltxt.mode') as string;
		mode.setModeStr(mode.getNextMode(m));
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
			simpletm.updateKeywordDecorations(context);
			updateErrorDecorations();
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

	registerCommand(context, 'Extension.dltxt.cursorToNextLine', motion.cursorToNextLine);

	registerCommand(context, 'Extension.dltxt.cursorToPrevLine', motion.cursorToPrevLine);

	registerCommand(context, 'Extension.dltxt.cursorToNextWord', motion.cursorToNextWord);
 
	registerCommand(context, 'Extension.dltxt.cursorToPrevWord', motion.cursorToPrevWord);

	registerCommand(context, 'Extension.dltxt.cursorToLineHead', motion.cursorToLineHead);

	registerCommand(context, 'Extension.dltxt.cursorToLineEnd', () => {
		motion.deleteUntil(true, false);
	});

	registerCommand(context, 'Extension.dltxt.cursorToSublineHead', () => {
		motion.cursorToSublineHead();
	});

	registerCommand(context, 'Extension.dltxt.cursorToSublineEnd', () => {
		motion.deleteUntil(false, false);
	});

	registerCommand(context, 'Extension.dltxt.moveToNextLine', () => {
		motion.moveToNextLine();
	});

	registerCommand(context, 'Extension.dltxt.moveToPrevLine', () => {
		motion.moveToPrevLine();
	});

	registerCommand(context, 'Extension.dltxt.deleteUntilPunc', () => {
		motion.deleteUntil(false, true);
	});

	registerCommand(context, 'Extension.dltxt.deleteAllAfter', () => {
		motion.deleteUntil(true, true);
	});

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

	registerCommand(context, 'Extension.dltxt.dlbuild.extract', () => {
		extract(context);
	});

	registerCommand(context, 'Extension.dltxt.dlbuild.pack', () => {
		pack(context);
	});

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
	

	singleline.activate(context);
	clipboard.activate(context);
	let trdb_tree = new trdb_view.TRDBTreeView(context, trdb.TRDBIndex);
	trdb.activate(context, trdb_tree);
	vscode.window.registerTreeDataProvider('dltxt-trdb', trdb_tree);
	auto_format.activate(context);
	
	vscode.languages.registerDocumentFormattingEditProvider('dltxt', {
		provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
			return formatter(context, document);
		}
	});

	migration(context);

}

// this method is called when your extension is deactivated
export function deactivate() { }

async function migration(context: vscode.ExtensionContext) {
	let oldVersion = ContextHolder.getGlobalState('dltxt.version') as string;
	if (!oldVersion) {
		oldVersion = "2.34";
	}
	const curVersion = vscode.extensions.getExtension('jsc723.translateassistant')?.packageJSON.version;
	if (!curVersion || oldVersion.length < 1 || curVersion.length < 1) {
		return;
	}
	
	if (true && oldVersion[0] == '2' && curVersion[0] == '3') {
		simpletm.migration(context);

	}

	ContextHolder.setGlobalState('dltxt.version', curVersion);
	
}

