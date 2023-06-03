// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import open = require('open');
import * as motion from './motion';
import { setCursorAndScroll } from './utils';
import * as fs from "fs"; 
import * as path from "path";
import {
	formatter, copyOriginalToTranslation,
	repeatFirstChar, getRegex
} from "./formatter";
import { batchConvertFilesEncoding } from './encoding';
import { extract, pack } from './dlbuild';
import { dltxt } from './treeview';
/*
(;\\[[a-z0-9]+\\])|((☆|●)[a-z0-9]+(☆|●))|(<\\d+>(?!//))|(//.*\n)
*/
//？！：；…—
//https://blog.csdn.net/yuan892173701/article/details/8731490
//https://gist.github.com/ryanmcgrath/982242
// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	let timeout: NodeJS.Timer | undefined = undefined;

	let copyToClipboardCmd = vscode.commands.registerCommand('Extension.dltxt.copyToClipboard', (arg) => {
        vscode.env.clipboard.writeText(arg.text).then(
			() => {
				vscode.window.showInformationMessage(`已复制`);
			},
			(reason) => {
				vscode.window.showInformationMessage(`复制失败: ${reason}`);
			}
		)
    });

	const keywordDecorationType = vscode.window.createTextEditorDecorationType({
		borderWidth: '1px',
		borderStyle: 'solid',
		overviewRulerColor: 'blue',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
		light: {
			// this color will be used in light color themes
			borderColor: 'darkblue',
			backgroundColor: 'lightblue'
		},
		dark: {
			// this color will be used in dark color themes
			borderColor: 'lightblue',
			backgroundColor: 'darkblue'
		}
	});

	const errorDecorationType = vscode.window.createTextEditorDecorationType({
		borderWidth: '1px',
		borderStyle: 'solid',
		isWholeLine: true,
		overviewRulerColor: 'red',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
		light: {
			// this color will be used in light color themes
			borderColor: 'darkred',
			backgroundColor: 'lightred'
		},
		dark: {
			// this color will be used in dark color themes
			borderColor: 'lightred',
			backgroundColor: 'darkred'
		}
	});

	let activeEditor = vscode.window.activeTextEditor;
	const configInit = vscode.workspace.getConfiguration("dltxt");
	const translatedPrefixRegex = configInit.get('core.translatedTextPrefixRegex');

	function updateKeywordDecorations() {
		const config = vscode.workspace.getConfiguration("dltxt");
		const game : string | undefined = config.get("simpleTM.project") as string;
		if (!activeEditor || !game) {
			return;
		}
		if (!config.get<boolean>('appearance.showKeywordHighlight')) {
			activeEditor.setDecorations(keywordDecorationType, []);
			return;
		}
		const keywords = context.workspaceState.get(`${game}.dict`) as Array<any>;
		const testArray: Array<String> = [];
		for (let i = 0; i < keywords.length; i++) {
			let v = keywords[i];
			let vr = v['raw'];
			if(vr)
				testArray.push(vr);
		}
		const regStr = testArray.join('|')
		if (!regStr)
			return
		const regEx = new RegExp(regStr, "g");
		let dict = new Map<String, string>();
		keywords.forEach(v => {
			dict.set(v['raw'], v['translate']);
		});
		const text = activeEditor.document.getText();
		const keywordsDecos: vscode.DecorationOptions[] = [];
		let match;
		while (keywordsDecos.length < 10000 && (match = regEx.exec(text))) {
			if (match[0].length === 0) {
				regEx.lastIndex++;
			}
			const startPos = activeEditor.document.positionAt(match.index);
			const endPos = activeEditor.document.positionAt(match.index + match[0].length);
			const word = dict.get(match[0])?.replace(/"/g, '');

			const linkCommand = `[copy](command:Extension.dltxt.copyToClipboard?{"text":"${word}"})`;
			const hoverMarkdown = new vscode.MarkdownString(`${word} ${linkCommand}`);
			hoverMarkdown.isTrusted = true;
			const decoration = {
				range: new vscode.Range(startPos, endPos),
				hoverMessage: hoverMarkdown,
				renderOptions: {
					// after: {
					// 	contentText: ""
					// }
				}
			};
			keywordsDecos.push(decoration);
		}
		activeEditor.setDecorations(keywordDecorationType, keywordsDecos);
	
	}

	let diagnosticCollection: Map<string, vscode.DiagnosticCollection> = new Map<string, vscode.DiagnosticCollection>();

	function getOrCreateDiagnosticCollection(file: string) : vscode.DiagnosticCollection | undefined {
		if (!diagnosticCollection.has(file)) {
			diagnosticCollection.set(file, vscode.languages.createDiagnosticCollection(`dltxt-${file}`));
		}
		return diagnosticCollection.get(file);
	}


	function updateErrorDecorations() {
		const config = vscode.workspace.getConfiguration("dltxt");
		
		if (!activeEditor) {
			return;
		}
		const fileName = activeEditor.document.fileName;
    	if(!fileName.endsWith('.txt')) {
			return;
		}
		const diagnosticCollection = getOrCreateDiagnosticCollection(fileName);
		if (!diagnosticCollection) {
			return;
		}
		diagnosticCollection.clear();
		let bShow = config.get<boolean>('appearance.showErrorHighlight');
		if (!bShow) {
			return;
		}
		const diagnostics: vscode.Diagnostic[] = [];
		const valid_regs = getRegex();

		let matched_count = 0;

		// Example syntax error - checking if each line starts with a specific character
		for (let lineNumber = 0; lineNumber < activeEditor.document.lineCount; lineNumber++) {
			const lineText = activeEditor.document.lineAt(lineNumber).text;
			if (!lineText) {
				continue;
			}
			let matched = false;
			for(let reg of valid_regs) {
				if (reg && reg.test(lineText)) {
					matched = true;
					break;
				}
			}
			if (!matched) {
				const range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
				const diagnostic = new vscode.Diagnostic(
					range,
					'格式错误',
					vscode.DiagnosticSeverity.Error
				);
				diagnostics.push(diagnostic);
			} else {
				matched_count++;
			}
        }
		//在错误数小于正确数时才报告错误
		if (diagnostics.length < matched_count) {
			diagnosticCollection.set(activeEditor.document.uri, diagnostics);
		}
    }

	
	
	function updateDecorations() {
		updateKeywordDecorations();
		updateErrorDecorations();
	}

	function triggerUpdateDecorations() {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		timeout = setTimeout(updateDecorations, 1000);
	}
	setInterval(() => {
		const config = vscode.workspace.getConfiguration("dltxt");
		if (vscode.window.activeTextEditor && config.get("simpleTM.project")) {
			vscode.commands.executeCommand('Extension.dltxt.sync_database');
		}
	}, 30000);

	if (activeEditor) {
		triggerUpdateDecorations();
	}

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

	let tree = new dltxt.TreeView();
	vscode.window.registerTreeDataProvider('dltxt_dict', tree);

	let syncDatabaseCommand = vscode.commands.registerCommand('Extension.dltxt.sync_database', function () {
		const config = vscode.workspace.getConfiguration("dltxt");
		const username: string = config.get("simpleTM.username") as string;
		const apiToken: string = config.get("simpleTM.apiToken") as string;
		if (!username || !apiToken) {
			return;
		}
		const BASE_URL = config.get('simpleTM.remoteHost');
		let GameTitle: string = config.get("simpleTM.project") as string;
		if (GameTitle) {
			let fullURL = BASE_URL + "/api/querybygame/" + GameTitle;
			axios.get(fullURL, {
				auth: {
					username: username, password: apiToken
				}
			}).then(result => {
				console.log(result);
				if (result) {
					context.workspaceState.update(`${GameTitle}.dict`, result.data);
					updateDecorations();
					tree.refresh(context);
				}
			});
		}
	});
	
	let newContextMenu_Insert = vscode.commands.registerCommand('Extension.dltxt.context_menu_insert', function () {
		const config = vscode.workspace.getConfiguration("dltxt");
		const username: string = config.get("simpleTM.username") as string;
		const apiToken: string = config.get("simpleTM.apiToken") as string;
		if (!username || !apiToken) {
			vscode.window.showErrorMessage("请在设置中填写账号与API Token后再使用同步功能");
			return;
		}
		const BASE_URL = config.get('simpleTM.remoteHost');
		let GameTitle: string = config.get("simpleTM.project") as string;
		if (!GameTitle) {
			vscode.window.showErrorMessage("请在设置中填写项目名后再使用同步功能");
			return;
		}
		vscode.window.showInputBox({ placeHolder: '(' + GameTitle + ')输入译文' })
			.then((translate: string | undefined) => {
				let editor = vscode.window.activeTextEditor;
				if (editor && !editor.selection.isEmpty) {
					const raw_text = editor.document.getText(editor.selection);
					var msg = raw_text + "->" + translate;
					const API_Query: string = BASE_URL + "/api/insert";
					let fullURL = API_Query + "/" + GameTitle + "/" + raw_text + "/" + translate;
					fullURL = encodeURI(fullURL);
					axios.get(fullURL, {
						auth: {
							username: username, password: apiToken
						}
					}).then(response => {
							if (response.data.Result === 'True') {
								vscode.window.showInformationMessage("Insert Success!\n" + msg);
							}
							else {
								vscode.window.showInformationMessage("unexpected json returned:\n" + response.data.Message);
							}
							vscode.commands.executeCommand('Extension.dltxt.sync_database');
						})
						.catch(error => {
							vscode.window.showInformationMessage("unexpected error:\n" + error);
						});
					} 
			})
	});
	let dictUpdateCmd = vscode.commands.registerCommand('Extension.dltxt.dict_update',　function (arg) {
		const config = vscode.workspace.getConfiguration("dltxt");
		const username: string = config.get("simpleTM.username") as string;
		const apiToken: string = config.get("simpleTM.apiToken") as string;
		if (!username || !apiToken) {
			vscode.window.showErrorMessage("请在设置中填写账号与API Token后再使用同步功能");
			return;
		}
		const BASE_URL = config.get('simpleTM.remoteHost');
		let GameTitle: string = config.get("simpleTM.project") as string;
		if (!GameTitle) {
			vscode.window.showErrorMessage("请在设置中填写项目名后再使用同步功能");
			return;
		}
		let editor = vscode.window.activeTextEditor;
		let rawText = arg ? arg : '';
		if (!rawText && editor && !editor.selection.isEmpty) {
			rawText = editor.document.getText(editor.selection);
		}
		if (!rawText) {
			return;
		}
		vscode.window.showInputBox({ placeHolder: '(' + GameTitle + `)输入"${rawText}"的译文` })
			.then((translate: string | undefined) => {
				if (translate === undefined) {
					return; //cancelled
				}
				let fullURL = "";
				var msg = "";
				if (translate) {
					msg = rawText + "->" + translate;
					fullURL = BASE_URL + "/api/update/" + GameTitle + "/" + rawText + "/" + translate;
					fullURL = encodeURI(fullURL);
				} else {
					msg = "deleted: " + rawText;
					fullURL = BASE_URL + "/api/delete/" + GameTitle + "/" + rawText
					fullURL = encodeURI(fullURL);
				}
				axios.get(fullURL, {
					auth: {
						username: username, password: apiToken
					}
				}).then(response => {
						if (response.data.Result === 'True') {
							vscode.window.showInformationMessage("Update Success!\n" + msg);
						}
						else {
							vscode.window.showInformationMessage("unexpected json returned:\n" + response.data.Message);
						}
						vscode.commands.executeCommand('Extension.dltxt.sync_database');
					})
					.catch(error => {
						vscode.window.showInformationMessage("unexpected error:\n" + error);
					});
			})
	});
	let newContextMenu_Update = vscode.commands.registerCommand('Extension.dltxt.context_menu_update',　function () {
		let editor = vscode.window.activeTextEditor;
		if (!editor || editor.selection.isEmpty) {
			return;
		}
		let rawText = editor.document.getText(editor.selection);
		if (!rawText) {
			return;
		}
		vscode.commands.executeCommand('Extension.dltxt.dict_update', rawText);
	});

	let dlEditor: vscode.TextEditor | undefined = undefined;
	let extractSingleline = vscode.commands.registerCommand('Extension.dltxt.extract_single_line', () => {
		console.log('extract single line');
		const document = vscode.window.activeTextEditor?.document;
		if (!document) return;
		const filePath: string = vscode.window.activeTextEditor?.document.uri.fsPath as string;
		if (!filePath) return;
		let prefixRegStr = translatedPrefixRegex;
		vscode.window.showInputBox({ placeHolder: '输入译文行首的正则表达式，如不输入则默认使用设置文件中的值' })
			.then(val => {
				if (val) {
					prefixRegStr = val;
				}
			})
			.then(() => {
				if (!prefixRegStr) {
					vscode.window.showErrorMessage('请提供译文行首的正则表达式');
					return;
				}
				const dirPath = path.dirname(filePath);
				const fileName = path.basename(filePath);
				const tempDirPath = dirPath + '\\.dltxt'
				if (!fs.existsSync(tempDirPath)) {
					fs.mkdirSync(tempDirPath);
				}
				const lines = [];
				const prefixReg = new RegExp(`^${prefixRegStr}` as string);
				for (let i = 0; i < document.lineCount; i++) {
					const line = document.lineAt(i).text;
					if (prefixReg.test(line))
						lines.push(line);
				}
				const slFilePath = tempDirPath + '\\' + fileName + '.sl';
				const refFilePath = tempDirPath + '\\' + fileName + '.ref';
				const data = lines.join('\r\n');
				fs.writeFileSync(slFilePath, data);
				fs.writeFileSync(refFilePath, prefixRegStr);
				let setting: vscode.Uri = vscode.Uri.file(slFilePath);
				dlEditor = vscode.window.activeTextEditor;
				vscode.workspace.openTextDocument(setting)
					.then((d: vscode.TextDocument) => {
						vscode.window.showTextDocument(d, vscode.ViewColumn.Beside, false);
					}, (err) => {
						console.error(err);
					});
			});
		
	});
	
	let mergeIntoDoubleLine = vscode.commands.registerCommand('Extension.dltxt.merge_into_double_line', async function(){
		if (!vscode.window.activeTextEditor) {
			vscode.window.showErrorMessage('请先选中需要更改的双行文本');
			return;
		}
		let curFilePath: string = vscode.window.activeTextEditor?.document.uri.fsPath as string;
		let dlFilePath: string;
		let slFilePath: string;
		let refFilePath: string;
		const m = curFilePath.match(/(.*)\.dltxt\\(.*)\.sl/);
		if (m) { //sl
			dlFilePath = m[1] + m[2];
			slFilePath = curFilePath;
			if (!dlEditor || !dlEditor?.document)
			{
				vscode.window.showErrorMessage('请先选中需要更改的双行文本');
				return;
			}
			await vscode.window.activeTextEditor.document.save();
			refFilePath = `${m[1]}.dltxt\\${m[2]}.ref`;
		} else { //dl
			dlFilePath = curFilePath;
			let dirPath = path.dirname(curFilePath);
			const dlFileName = path.basename(curFilePath);
			const tempDirPath = dirPath + '\\.dltxt';
			slFilePath = tempDirPath + '\\' + dlFileName + '.sl';
			if (fs.existsSync(slFilePath)) {
				dlEditor = vscode.window.activeTextEditor;
				refFilePath = tempDirPath + '\\' + dlFileName + '.ref';
			} else {
				vscode.window.showErrorMessage('请先提取译文');
				return;
			}
			let slDocument = await vscode.workspace.openTextDocument(slFilePath);
			await slDocument.save();
		}
		let prefixRegStr: string;
		try {
		  prefixRegStr = fs.readFileSync(refFilePath, 'utf8') as string;
			if (!prefixRegStr)
				throw new Error();
		} catch {
			vscode.window.showErrorMessage('译文提取时的信息被删除，请重新提取');
			return;
		}
		const prefixReg = new RegExp(`^(${prefixRegStr})`);
		const replacedLines = fs.readFileSync(slFilePath, 'utf8').split(/\r?\n/);
		let dlDocument = dlEditor.document;
		dlEditor?.edit(editBuilder => {
			let j = 0;
			for (let i = 0; i < dlDocument.lineCount; i++) {
				const line = dlDocument.lineAt(i);
				if (prefixReg.test(line.text)) {
					editBuilder.replace(line.range, replacedLines[j++]);
				}
			}
		});
	});

	// Register a tab close event listener
	const removeTempListerner = vscode.workspace.onDidCloseTextDocument((document) => {
		const isDltxtSingleLineFile = (filePath: string): boolean => {
			return filePath.includes('.dltxt') && filePath.endsWith('.sl');
		}

		if (!vscode.workspace.textDocuments.includes(document)
			&& isDltxtSingleLineFile(document.uri.fsPath)) {
			// Delete the document file
			const filePath = document.uri.fsPath;
			const {dir, base, ext, name} = path.parse(filePath);
			const refPath = path.join(dir, name + '.ref');
			fs.unlink(filePath, (error) => {
				if (error) {
				console.error('Failed to delete file:', error);
				} else {
				// File deletion successful
				}
			});
			fs.unlink(refPath, (error) => {
				if (error) {
					console.error('Failed to delete file:', error);
				} else {
					// File deletion successful
				}
			});
		}
	  });
	

	let copyOriginalCmd = vscode.commands.registerCommand('Extension.dltxt.copy_original', () => {
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

	let cursorNextLineCmd = vscode.commands.registerCommand('Extension.dltxt.cursorToNextLine', () => {
		motion.cursorToNextLine();
	});

	let cursorPrevLineCmd = vscode.commands.registerCommand('Extension.dltxt.cursorToPrevLine', () => {
		motion.cursorToPrevLine();
	});

	let cursorNextWordCmd = vscode.commands.registerCommand('Extension.dltxt.cursorToNextWord', () => {
		motion.cursorToNextWord();
	});

	let cursorPrevWordCmd = vscode.commands.registerCommand('Extension.dltxt.cursorToPrevWord', () => {
		motion.cursorToPrevWord();
	});

	let cursorToLineHeadCmd = vscode.commands.registerCommand('Extension.dltxt.cursorToLineHead', () => {
		motion.cursorToLineHead();
	});

	let cursorToLineEndCmd = vscode.commands.registerCommand('Extension.dltxt.cursorToLineEnd', () => {
		motion.deleteUntil(true, false);
	});

	let cursorToSublineHeadCmd = vscode.commands.registerCommand('Extension.dltxt.cursorToSublineHead', () => {
		motion.cursorToSublineHead();
	});

	let cursorToSublineEndCmd = vscode.commands.registerCommand('Extension.dltxt.cursorToSublineEnd', () => {
		motion.deleteUntil(false, false);
	});


	let moveToNextLineCmd = vscode.commands.registerCommand('Extension.dltxt.moveToNextLine', () => {
		motion.moveToNextLine();
	});

	let moveToPrevLineCmd = vscode.commands.registerCommand('Extension.dltxt.moveToPrevLine', () => {
		motion.moveToPrevLine();
	});

	let deleteUntilPuncCmd = vscode.commands.registerCommand('Extension.dltxt.deleteUntilPunc', () => {
		motion.deleteUntil(false, true);
	});

	let deleteAllAfterCmd = vscode.commands.registerCommand('Extension.dltxt.deleteAllAfter', () => {
		motion.deleteUntil(true, true);
	});


	let repeatFirst = vscode.commands.registerCommand('Extension.dltxt.repeatFirst', () => {
		let editor = vscode.window.activeTextEditor;
		let document = editor?.document;
		if (!editor || !document) 
			return;
		editor.edit(editBuilder => {
			repeatFirstChar(context, editor as vscode.TextEditor, editBuilder);
		})
		setCursorAndScroll(editor, 0, editor.selection.start.character + 2, false);
	});

	let convertEncoding = vscode.commands.registerCommand('Extension.dltxt.convertToEncoding', 
		batchConvertFilesEncoding);

	let extractCmd = vscode.commands.registerCommand('Extension.dltxt.dlbuild.extract', () => {
		extract(context);
	});

	let packCmd = vscode.commands.registerCommand('Extension.dltxt.dlbuild.pack', () => {
		pack(context);
	});


	context.subscriptions.push(
		copyToClipboardCmd,
		syncDatabaseCommand,
		newContextMenu_Insert,
		dictUpdateCmd,
		newContextMenu_Update,
		cursorNextLineCmd,
		cursorPrevLineCmd,
		cursorNextWordCmd,
		cursorPrevWordCmd,
		cursorToSublineHeadCmd,
		cursorToSublineEndCmd,
		cursorToLineHeadCmd,
		cursorToLineEndCmd,
		moveToNextLineCmd,
		moveToPrevLineCmd,
		deleteUntilPuncCmd,
		deleteAllAfterCmd,
		repeatFirst,
		copyOriginalCmd,
		mergeIntoDoubleLine,
		extractSingleline,
		convertEncoding,
		extractCmd,
		packCmd,
		removeTempListerner
	);
	
	vscode.languages.registerDocumentFormattingEditProvider('dltxt', {
		provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
			return formatter(context, document);
		}
	});
	vscode.commands.executeCommand('Extension.dltxt.sync_database');

}

// this method is called when your extension is deactivated
export function deactivate() { }

/*
TODO:
-- v0.1
1. key-binding to next position to edit [DONE]
2. highlight for other format [DONE]
-- v0.2
1. syntax highlight for more format [DONE]
2. let user configure format [DONE]
3. hotkey for all format [DONE]
4. highlight for name [DONE]
-- v1.0
1. highlight keywords [DONE]
	- highlight and hover [DONE]
	- switch highlight off [DONE]
2. backend [DONE]
	- login 
	- delete
	- database:
		user table (*id, name, password_hash),
		game table (*game id, %owner id, game title), 
		term table (*game id, *term id, raw, translate) 
		permission (*user id, *game id, permission level (read, write, admin))
3. Chinese Readme [DONE]
4. auto scroll to middle on hotkey [DONE]
5. update request format to fit remote update [DONE]
-- v2.0
- Auto format (configurable)
 -　... -> …… [DONE]
 -　引号 [DONE]
 -　半角－＞全角 [DONE] 
 -　文本末尾句号 [DONE]
 -　破折号 [DONE]
 -　波浪号 [DONE]
-- v2.1
 - 右键菜单 [DONE]
 - 优化提取、应用译文功能[DONE]
-- v2.2
 - 查词 [DONE]
-- v2.3
 - 自动变结巴 [DONE]
 - 浅色主题 [DONE]
-- v2.4
 - 引号问题 [DONE]
 - 修正sync database的问题 []
-- v2.5
 - 批量操作 []

https://www.mojidict.com/_nuxt/app/b3f87f7f.f1a5be3.js
            n._ApplicationId = r.a.parseApplicationId_prod,
            n._InstallationId = r.a.parseInstallationId_prod,
						n._ClientVersion = r.a.parseClientVersion_prod,
										
						parseClientVersion_prod: "js2.12.0",
            parseInstallationId_prod: "5562c88b-b67a-c285-b9d1-a8360121380a",
						parseApplicationId_prod: "E62VyFVLMiW7kvbtVq3p",
document.cookie.split(';').map((s) => (s.trim().split('='))).filter((s)=>(s[0]==='pst'))[0].map(unescape)[1]

*/