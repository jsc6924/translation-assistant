import * as vscode from 'vscode'
import axios from 'axios';
import * as fs from 'fs';
import { dict_view } from './treeview';
import { registerCommand, DictSettings, ContextHolder } from './utils';
const AhoCorasick = require('ahocorasick');


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
		DictSettings.setAllDictNames(allDicts);
		if (type == '远程术语库') {
			dictTree?.addRemoteDict(name);
		} else if (type == '本地术语库') {
			dictTree?.addLocalDict(name);
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
		if (names.includes(item.dictName)) {
			DictSettings.removeDict(item.dictName);
			dictTree?.removeDict(item);
		}
	});

	async function pickPath(): Promise<string| undefined> {
		const options = ['新建本地术语库', '打开本地术语库'];
		const r = await vscode.window.showQuickPick(options, {
			placeHolder: '请选择一个操作继续'
		});
		if (r === undefined) {
			return undefined;
		}
		if (r == options[0]) {
			let res = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file('dltxtLocalDict.json'),
				title: "选择保存路径"
			});
			if (res === undefined) {
				return undefined;
			}
			fs.writeFileSync(res.fsPath, JSON.stringify({'values': []}), { encoding: 'utf8'});
			return res.fsPath;
		} else {
			const uris = await vscode.window.showOpenDialog({
				defaultUri: vscode.Uri.file('dltxtLocalDict.json'),
				canSelectMany: false,
				canSelectFolders: false,
				title: "选择要打开的术语库"
			});
			if (!uris || uris.length == 0) {
				return undefined;
			}
			return uris[0].fsPath;
		}
	}

	registerCommand(context, 'Extension.dltxt.setGlobalState', async (args) => {
		const config = args.config;
		const callback = args.callback;
		const oldValue = ContextHolder.getGlobalState(config) as string;
		let newValue = undefined; 
		if (args.usePathPicker) {
			newValue = await pickPath();
		} else {
			if (args.selections) {
				newValue = await vscode.window.showQuickPick(args.selections, {
					placeHolder: `选择${config}的值`
				})
			} else {
				newValue = await vscode.window.showInputBox({
					value: oldValue,
					prompt: `输入${config}的值`
				});
			}
		}
		if (newValue === undefined) {
			if (callback) callback();
			return;
		}
		ContextHolder.setGlobalState(config, newValue);
		if (callback) callback();
	});

	registerCommand(context, 'Extension.dltxt.setWorkspaceState', async (args) => {
		const config = args.config;
		const callback = args.callback;
		const oldValue = ContextHolder.getWorkspaceState(config) as string;
		let newValue = undefined; 
		if (args.usePathPicker) {
			newValue = await pickPath();
		} else {
			if (args.selections) {
				newValue = await vscode.window.showQuickPick(args.selections, {
					placeHolder: `选择${config}的值`
				})
			} else {
				newValue = await vscode.window.showInputBox({
					value: oldValue,
					prompt: `输入${config}的值`
				});
			}
		}
		if (newValue === undefined) {
			if (callback) callback();
			return;
		}
		ContextHolder.setWorkspaceState(config, newValue);
		if (callback) callback();
	});

	async function syncDatabase(name: string) {
		if (!name) {
			vscode.window.showErrorMessage("name不能为空");
			return;
		}
		const type = DictSettings.getDictType(name);
		if (type != 'remote') {
			try {
				const fsPath = DictSettings.getLocalDictPath(name);
				if (!fsPath) {
					return;
				}
				const content = fs.readFileSync(fsPath, { encoding: 'utf8'});
				const contentObj = JSON.parse(content);
				const values: any[] = contentObj['values'];
				DictSettings.setLocalDictKeys(name, values);
				const dictNode = dictTree?.getDictByName(name);
				dictTree?.refresh(dictNode);
			} catch (error) {
				console.error(error);
			}
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
		updateKeywordDecorations();
	});

	registerCommand(context, 'Extension.dltxt.sync_all_database', async function () {
		const dictNames = DictSettings.getAllDictNames();
		for (const name of dictNames) {
			await syncDatabase(name);
		}
		updateKeywordDecorations();
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

	async function insertLocal(dictName: string) {
		const translate = await vscode.window.showInputBox({ placeHolder: '输入译文' })
		let editor = vscode.window.activeTextEditor;
		if (editor && !editor.selection.isEmpty) {
			const raw_text = editor.document.getText(editor.selection);
			let msg = raw_text + "->" + translate;
			try {
				updateLocalDictKey(dictName, raw_text, translate);
				vscode.window.showInformationMessage("词条添加成功!\n" + msg);
			} catch (err) {
				vscode.window.showErrorMessage(`词条添加失败：${err}`);
			}
			vscode.commands.executeCommand('Extension.dltxt.sync_database', dictName);
		}
	}

	async function batchInsertLocal(dictName: string) {
		const options: vscode.OpenDialogOptions = {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
              'XLSX Files': ['xlsx'],
              'All Files': ['*']
            }
          };
        
        const fileUris = await vscode.window.showOpenDialog(options);
        if (fileUris && fileUris.length > 0) {
                const filePath = fileUris[0].fsPath;
				const XLSX = require('xlsx');

				// Load the XLSX file
				const workbook = XLSX.readFile(filePath); // Replace with the actual path to your XLSX file

				// Choose the first sheet in the workbook
				const sheetName = workbook.SheetNames[0];
				const sheet = workbook.Sheets[sheetName];

				// Parse the sheet's data into an array of objects
				const data = XLSX.utils.sheet_to_json(sheet);

				console.log(data); // Print the parsed data

				batchUpdateLocalDictKey(dictName, data);
				vscode.commands.executeCommand('Extension.dltxt.sync_database', dictName);
        }
	}

	registerCommand(context, 'Extension.dltxt.batch_insert_local', async function() {
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
			batchInsertLocal(name);
			return;
		}
		vscode.window.showErrorMessage('not supported');
	});


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
			insertLocal(name);
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

	async function updateDictLocal(name: string, rawText: string, wantDelete: boolean) {
		let translate: string | undefined = '';
		if (!wantDelete) {
			translate = await vscode.window.showInputBox({ placeHolder: `输入"${rawText}"的译文，输入空字符串删除译文，点击空白处取消` })	
			if (translate === undefined) {
				return; //cancelled
			}
		}
		if (translate) {
			const msg = rawText + "->" + translate;
			try {
				updateLocalDictKey(name, rawText, translate);
				vscode.window.showInformationMessage("词条更新成功!\n" + msg);
			} catch (err) {
				vscode.window.showErrorMessage(`更新词条失败：${err}`);
			}
		} else {
			const msg = "deleted: " + rawText;
			if (await vscode.window.showWarningMessage(`要删除词条"${rawText}"吗？`, '是', '否') == '是') {
				try {
					updateLocalDictKey(name, rawText, undefined);
					vscode.window.showInformationMessage("词条更新成功!\n" + msg);
				} catch (err) {
					vscode.window.showErrorMessage(`更新词条失败：${err}`);
				}
			}
		}
		vscode.commands.executeCommand('Extension.dltxt.sync_database', name);
		
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
			await updateDictLocal(name, rawText, wantDelete);
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


export function updateKeywordDecorations() {

    let activeEditor = vscode.window.activeTextEditor;
    const config = vscode.workspace.getConfiguration("dltxt");
    if (!activeEditor) {
        return;
    }


	

	const dictNames = DictSettings.getAllDictNames();
	for (const dictName of dictNames) {
		const {deco, oldDeco, changed} = DictSettings.getDictDecoration(dictName);
		const keywordsDecos: vscode.DecorationOptions[] = [];
		const type = DictSettings.getDictType(dictName);
		const showHighLight = DictSettings.getStyleShow(dictName);
		if (!showHighLight) {
			if (oldDeco) {
				activeEditor.setDecorations(oldDeco, []);
			}
			if (deco) {
				activeEditor.setDecorations(deco, []);
			}
			continue;
		}
		if (changed && oldDeco) {
			activeEditor.setDecorations(oldDeco, []);
		}

		let keywords = [];
		if (type === 'local') {
			keywords = DictSettings.getLocalDictKeys(dictName);
		} else {
			let game : string | undefined = DictSettings.getGameTitle(dictName);
			if (!game) {
				continue;
			}
			keywords = DictSettings.getSimpleTMDictKeys(dictName, game);
		}
		const testArray: Array<String> = [];
		for (let i = 0; i < keywords.length; i++) {
			let v = keywords[i];
			let vr = v['raw'];
			if(vr)
				testArray.push(vr);
		}
		if (testArray.length === 0) {
			continue;
		}
		let dict = new Map<String, string>();
		keywords.forEach(v => {
			dict.set(v['raw'], v['translate']);
		});
		const text = activeEditor.document.getText();

		const ac = new AhoCorasick(testArray);
		const results = ac.search(text) as any[];
		for(let res of results) {
			const endIndex = res[0];
			const keywords = res[1];
			for(let keyword of keywords) {
				const index = endIndex + 1 - keyword.length;
				const startPos = activeEditor.document.positionAt(index);
				const endPos = activeEditor.document.positionAt(index + keyword.length);
				const word = dict.get(keyword)?.replace(/"/g, '');
				const linkCommand = `[copy](command:Extension.dltxt.copyToClipboard?{"text":"${encodeURIComponent(word as string)}"})`;
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
		activeEditor.setDecorations(deco, keywordsDecos);
	}
    
}

function updateLocalDictKey(dictName: string, key: string, value: string | undefined): boolean {
	let keys = DictSettings.getLocalDictKeys(dictName);
	for(let i = 0; i < keys.length; i++) {
		if (keys[i]['raw'] == key) {
			if (value === undefined) {
				keys.splice(i, 1);
				writeLocalDictKey(dictName, keys);
				return true;
			} else {
				keys[i]['translate'] = value;
				writeLocalDictKey(dictName, keys);
				return true;
			}
		}
	}
	if (value) {
		keys.push({"raw": key, "translate": value});
		writeLocalDictKey(dictName, keys);
		return true;
	}
	return false;
}

function batchUpdateLocalDictKey(dictName: string, kvs: any[]): boolean {
	let data = DictSettings.getLocalDictKeys(dictName);
	for(const kv of kvs) {
		let processed = false;
		if (kv.hasOwnProperty('key')) {
			const key = kv.key;
			const value = kv.value;
			for(let i = 0; i < data.length && !processed; i++) {
				if (data[i]['raw'] == key) {
					if (value === undefined) {
						data.splice(i, 1);
						processed = true;
					} else {
						data[i]['translate'] = value;
						processed = true;
					}
				}
			}
			if (value && !processed) {
				data.push({"raw": key, "translate": value});
			}
		}

	}
	writeLocalDictKey(dictName, data);
	return true;
}

function writeLocalDictKey(dictName: string, values: any[]) {
	const path = DictSettings.getLocalDictPath(dictName);
	const contentObj = {'values': values }
	fs.writeFileSync(path, JSON.stringify(contentObj), {encoding: 'utf8'});
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