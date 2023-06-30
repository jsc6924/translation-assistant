import * as vscode from 'vscode'
import axios from 'axios';
import { dltxt } from './treeview';
import { registerCommand } from './utils';

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

export function activate(context: vscode.ExtensionContext) {
	const configInit = vscode.workspace.getConfiguration("dltxt");

    const syncInterval = configInit.get("simpleTM.syncInterval") as number;
	if (syncInterval > 0) {
		let syncIntervalMS = Math.max(syncInterval, 30) * 1000;
		setInterval(() => {
			const config = vscode.workspace.getConfiguration("dltxt");
			if (vscode.window.activeTextEditor && config.get("simpleTM.project")) {
				vscode.commands.executeCommand('Extension.dltxt.sync_database');
			}
		}, syncIntervalMS);
	}

    
    let tree = new dltxt.DictTreeView();
	vscode.window.registerTreeDataProvider('dltxt-dict', tree);

	registerCommand(context, 'Extension.dltxt.sync_database', function () {
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
					updateKeywordDecorations(context);
					tree.refresh(context);
				}
			});
		}
	});
	
	registerCommand(context, 'Extension.dltxt.context_menu_insert', function () {
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
								vscode.window.showInformationMessage("词条添加成功!\n" + msg);
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
	registerCommand(context, 'Extension.dltxt.dict_update',　function (arg, wantDelete = false) {
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
		const updateFunc = (translate: string | undefined) => {
			if (translate === undefined) {
				return; //cancelled
			}
			const makeRequest = (fullURL: string) => {
				axios.get(fullURL, {
					auth: {
						username: username, password: apiToken
					}
				}).then(response => {
						if (response.data.Result === 'True') {
							vscode.window.showInformationMessage("词条更新成功!\n" + msg);
						}
						else {
							vscode.window.showInformationMessage("unexpected json returned:\n" + response.data.Message);
						}
						vscode.commands.executeCommand('Extension.dltxt.sync_database');
					})
					.catch(error => {
						vscode.window.showInformationMessage("unexpected error:\n" + error);
					});
			};

			let fullURL = "";
			var msg = "";
			if (translate) {
				msg = rawText + "->" + translate;
				fullURL = BASE_URL + "/api/update/" + GameTitle + "/" + rawText + "/" + translate;
				fullURL = encodeURI(fullURL);
				makeRequest(fullURL);
			} else {
				msg = "deleted: " + rawText;
				fullURL = BASE_URL + "/api/delete/" + GameTitle + "/" + rawText
				fullURL = encodeURI(fullURL);
				vscode.window.showWarningMessage(`要删除词条"${rawText}"吗？`, '是', '否')
				.then(result => {
					if (result == '是') {
						makeRequest(fullURL);
					}
				});
			}
		};
		if (!wantDelete) {
			vscode.window.showInputBox({ placeHolder: '(' + GameTitle + `)输入"${rawText}"的译文，输入空字符串删除译文，点击空白处取消` })
				.then(updateFunc);
		} else {
			updateFunc(''); //delete
		}
	});
	registerCommand(context, 'Extension.dltxt.context_menu_update',　function () {
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
}


export function updateKeywordDecorations(context: vscode.ExtensionContext) {
    let activeEditor = vscode.window.activeTextEditor;
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
            renderOptions: {}
        };
        keywordsDecos.push(decoration);
    }
    activeEditor.setDecorations(keywordDecorationType, keywordsDecos);

}
