import * as vscode from 'vscode'
import axios from 'axios';
import { dict_view } from './treeview';
import { registerCommand, DictSettings } from './utils';
import { channel } from './dlbuild';

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

export const SimpleTMDefaultURL = "https://simpletm.jscrosoft.com/";

let dictTree: dict_view.DictTreeView | undefined = undefined; 

export function activate(context: vscode.ExtensionContext) {
	const configInit = vscode.workspace.getConfiguration("dltxt");

    const syncInterval = configInit.get("simpleTM.syncInterval") as number;
	if (syncInterval > 0) {
		let syncIntervalMS = Math.max(syncInterval, 30) * 1000;
		setInterval(() => {
			const config = vscode.workspace.getConfiguration("dltxt");
			if (vscode.window.activeTextEditor && config.get("simpleTM.project")) {
				vscode.commands.executeCommand('Extension.dltxt.sync_all_database');
			}
		}, syncIntervalMS);
	}

    
    dictTree = new dict_view.DictTreeView();
	vscode.window.registerTreeDataProvider('dltxt-dict', dictTree);

	registerCommand(context, 'Extension.dltxt.treeview.dict.addDict', async () => {
		const type = await vscode.window.showQuickPick(['本地术语库', '远程术语库'], {
			canPickMany: false,
			placeHolder: "请选择术语库类型"
		});
		if (type === undefined) {
			return;
		}
		if (type == '远程术语库') {
			const name = await vscode.window.showInputBox({
				prompt: '为新建的术语库起一个名字',
				value: "new-dictionary"
			});
			if (!name) {
				return;
			}
			const allDicts = DictSettings.getAllDictNames();
			if (allDicts.includes(name)) {
				vscode.window.showErrorMessage(`术语库${name}已存在`);
				return;
			}
			allDicts.push(name);
			await DictSettings.setAllDictNames(allDicts);
			dictTree?.addRemoteDict(name);
		}
		if (type == '本地术语库') {
			vscode.window.showInformationMessage('暂不支持本地术语库');
			return;
		}
		dictTree?.refresh();
	});

	registerCommand(context, 'Extension.dltxt.treeview.dict.removeDict', async (item: dict_view.DictRootItem) => {
		const res = await vscode.window.showWarningMessage(`确定要断开与术语库${item.dictName}的连接吗`, 
			"是", "否");
		if (res != '是') {
			return;
		}
		const names = DictSettings.getAllDictNames();
		const type = DictSettings.getDictType(item.dictName);
		if (type == 'remote' && names.includes(item.dictName)) {
			DictSettings.removeDict(item.dictName);
			dictTree?.removeRemoteDict(item);
		}
	});

	async function syncDatabase(name: string) {
		if (!name) {
			vscode.window.showErrorMessage("name不能为空");
			return;
		}
		const type = DictSettings.getDictType(name);
		if (type != 'remote') {
			vscode.window.showErrorMessage("暂不支持remote以外的术语库");
			return;
		}
		const username = DictSettings.getSimpleTMUsername(name);
		const apiToken = DictSettings.getSimpleTMApiToken(name);
		if (!username || !apiToken) {
			return;
		}
		const BASE_URL = DictSettings.getSimpleTMUrl(name);
		let GameTitle = DictSettings.getGameTitle(name);
		if (GameTitle) {
			let fullURL = BASE_URL + "/api/querybygame/" + GameTitle;
			return axios.get(fullURL, {
				auth: {
					username: username, password: apiToken
				}
			}).then(result => {
				console.log(result);
				if (result && GameTitle) {
                    DictSettings.setSimpleTMDictKeys(name, GameTitle, result.data);
					const dictNode = dictTree?.getDictByName(name);
					dictTree?.refresh(dictNode);
				}
			}).catch((err) => {
				if (GameTitle) {
					DictSettings.setSimpleTMDictKeys(name, GameTitle, undefined);
					const dictNode = dictTree?.getDictByName(name);
					dictTree?.refresh(dictNode);
				}
				console.error(err);
			});
		}
	}

	registerCommand(context, 'Extension.dltxt.sync_database', async function (name: string) {
		await syncDatabase(name);
		updateKeywordDecorations(context);
	});

	registerCommand(context, 'Extension.dltxt.sync_all_database', async function () {
		const dictNames = DictSettings.getAllDictNames();
		for (const name of dictNames) {
			if (DictSettings.getDictType(name) == 'remote') {
				await syncDatabase(name);
			}
		}
		updateKeywordDecorations(context);
	});
	
	async function insertRemote(dictName: string) {
		const username = DictSettings.getSimpleTMUsername(dictName);
		const apiToken = DictSettings.getSimpleTMApiToken(dictName);
		if (!username || !apiToken) {
			vscode.window.showErrorMessage("请在设置中填写账号与API Token后再使用同步功能");
			return;
		}
		const BASE_URL = DictSettings.getSimpleTMUrl(dictName);
		let GameTitle = DictSettings.getGameTitle(dictName);
		if (!GameTitle) {
			vscode.window.showErrorMessage("请在设置中填写项目名后再使用同步功能");
			return;
		}
		const translate = await vscode.window.showInputBox({ placeHolder: '(' + GameTitle + ')输入译文' })
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
			})
			.then(response => {
				if (response.data.Result === 'True') {
					vscode.window.showInformationMessage("词条添加成功!\n" + msg);
				}
				else {
					vscode.window.showInformationMessage("unexpected json returned:\n" + response.data.Message);
				}
				vscode.commands.executeCommand('Extension.dltxt.sync_database', dictName);
			})
			.catch(error => {
				vscode.window.showInformationMessage("unexpected error:\n" + error);
			});
		}

	}

	registerCommand(context, 'Extension.dltxt.context_menu_insert', async function () {
		const dictNames = DictSettings.getAllDictNames();
		if (dictNames.length == 0) {
			vscode.window.showInformationMessage('需要先连接术语库');
			return;
		}
		let name : string | undefined = '';
		if (dictNames.length == 1) {
			name = dictNames[0];
		}
		else {
			name = await vscode.window.showQuickPick(dictNames, {
				'canPickMany': false,
				'placeHolder': '选择一个术语库插入'
			});
			if (!name) {
				return;
			}
		}

		const type = DictSettings.getDictType(name);
		if (type != 'remote') {
			vscode.window.showErrorMessage("暂不支持remote以外的术语库");
			return;
		}
		await insertRemote(name);
	});

	async function updateDictRemote(name: string, rawText: string, wantDelete: boolean) {
		const username = DictSettings.getSimpleTMUsername(name);
		const apiToken = DictSettings.getSimpleTMApiToken(name);
		if (!username || !apiToken) {
			vscode.window.showErrorMessage("请在设置中填写账号与API Token后再使用同步功能");
			return;
		}
		const BASE_URL = DictSettings.getSimpleTMUrl(name);
		let GameTitle = DictSettings.getGameTitle(name);
		if (!GameTitle) {
			vscode.window.showErrorMessage("请在设置中填写项目名后再使用同步功能");
			return;
		}
		let translate: string | undefined = '';
		if (!wantDelete) {
			translate = await vscode.window.showInputBox({ placeHolder: '(' + GameTitle + `)输入"${rawText}"的译文，输入空字符串删除译文，点击空白处取消` })	
			if (translate === undefined) {
				return; //cancelled
			}
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
					vscode.commands.executeCommand('Extension.dltxt.sync_database', name);
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
		
	}

	registerCommand(context, 'Extension.dltxt.dict_update',　async function (name: string, key: string, wantDelete = false) {
		let editor = vscode.window.activeTextEditor;
		let rawText = key ? key : '';
		if (!rawText && editor && !editor.selection.isEmpty) {
			rawText = editor.document.getText(editor.selection);
		}
		if (!rawText) {
			return;
		}

		const type = DictSettings.getDictType(name);
		if (type != 'remote') {
			vscode.window.showErrorMessage("暂不支持remote以外的术语库");
			return;
		}

		await updateDictRemote(name, rawText, wantDelete);
	});
	registerCommand(context, 'Extension.dltxt.context_menu_update', async　function () {
		let editor = vscode.window.activeTextEditor;
		if (!editor || editor.selection.isEmpty) {
			return;
		}
		let rawText = editor.document.getText(editor.selection);
		if (!rawText) {
			return;
		}
		const dictNames = DictSettings.getAllDictNames();
		if (dictNames.length == 0) {
			vscode.window.showInformationMessage('需要先连接术语库');
			return;
		}
		let name : string | undefined = '';
		if (dictNames.length == 1) {
			name = dictNames[0];
		}
		else {
			name = await vscode.window.showQuickPick(dictNames, {
				'canPickMany': false,
				'placeHolder': '选择一个术语库插入'
			});
			if (!name) {
				return;
			}
		}
		vscode.commands.executeCommand('Extension.dltxt.dict_update', name, rawText);
	});

	vscode.commands.executeCommand('Extension.dltxt.sync_all_database');
}


export function updateKeywordDecorations(context: vscode.ExtensionContext) {

    let activeEditor = vscode.window.activeTextEditor;
    const config = vscode.workspace.getConfiguration("dltxt");
    if (!activeEditor) {
        return;
    }

    if (!config.get<boolean>('appearance.showKeywordHighlight')) {
        activeEditor.setDecorations(keywordDecorationType, []);
        return;
    }
	const keywordsDecos: vscode.DecorationOptions[] = [];

	const dictNames = DictSettings.getAllDictNames();
	for (const dictName of dictNames) {
		let game : string | undefined = DictSettings.getGameTitle(dictName);
		const type = DictSettings.getDictType(dictName);
		if (!game && type === 'local') {
			game = 'default'; //for local dict
		} else if (!game) {
			continue;
		}
		const keywords = DictSettings.getSimpleTMDictKeys(dictName, game);
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
	}
    activeEditor.setDecorations(keywordDecorationType, keywordsDecos);
}


export async function migration(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('dltxt');
	let url = config.get('simpleTM.remoteHost');
	const user = config.get('simpleTM.username');
	const api = config.get('simpleTM.apiToken');
	const game = config.get('simpleTM.project');
	if (dictTree?.roots.length == 0 && (url || user || api || game)) {
		if (!url) {
			url = 'https://simpletm.jscrosoft.com/';
		}
		const name = 'remote-dictionary';
		const allDicts = DictSettings.getAllDictNames();
		if (allDicts.includes(name)) {
			return;
		}
		allDicts.push(name);
		await DictSettings.setAllDictNames(allDicts);
		dictTree?.addRemoteDict(name, {url: url, user: user, api: api, game: game});
		vscode.commands.executeCommand('Extension.dltxt.sync_all_database');
	}
}