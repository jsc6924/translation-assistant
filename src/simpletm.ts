import * as vscode from 'vscode'
import axios from 'axios';
import * as fs from 'fs';
import { dict_view } from './treeview';
import { registerCommand, DictSettings, ContextHolder, DictType, pathConcat } from './utils';
import { editorWriteString } from './motion';
import { DocumentParser } from './parser';
const AhoCorasick = require('ahocorasick');


export const SimpleTMDefaultURL = "https://simpletm.jscrosoft.com";

export let dictTree: dict_view.DictTreeView | undefined = undefined; 

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
		const type = await vscode.window.showQuickPick(['本地术语库', '远程术语库（SimpleTM User）','远程术语库（SimpleTM URL）'], {
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
		if (type == '远程术语库（SimpleTM User）') {
			dictTree?.addRemoteUserDict(name);
		} else if (type == '远程术语库（SimpleTM URL）') {
			dictTree?.addRemoteURLDict(name);
		}
		else if (type == '本地术语库') {
			dictTree?.addLocalDict(name);
		}
		dictTree?.dataChanged();
	});

	registerCommand(context, 'Extension.dltxt.treeview.dict.exportDict', async () => {
		const allDicts = DictSettings.getAllDictNames();
		const dictName = await vscode.window.showQuickPick(allDicts, {
			canPickMany: false,
			placeHolder: "选择一个术语库"
		});
		if (!dictTree || !dictName) {
			return;
		}
		const dict = dictTree.getDictByName(dictName);
		const content = dict?.contentNode;
		if (!content) {
			return; //should never happen
		}

		const saveOptions: vscode.SaveDialogOptions = {
            title: '导出术语库',
            defaultUri: vscode.Uri.file(`${dictName}.xlsx`),
            filters: {
              'XLSX Files': ['xlsx']
            }
          };
        
        const saveUri = await vscode.window.showSaveDialog(saveOptions);
        if(!saveUri) {
            return;
        }

		const data: any[] = [['key', 'value']];
		for(const item of content.children) {
			data.push([item.key, item.value]);
		}

		const XLSX = require('xlsx');
		const workbook = XLSX.utils.book_new();
		const worksheet = XLSX.utils.aoa_to_sheet(data);
		XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
		XLSX.writeFile(workbook, saveUri.fsPath);

		vscode.window.showInformationMessage(`成功导出到${saveUri.fsPath}`);
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

	async function pickPath(): Promise<string| undefined | null> {
		const options = ['新建本地术语库', '打开本地术语库', '与本地术语库断开连接'];
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
		} else if (r == options[1]) {
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
		} else {
			return null;
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
		if (newValue === null) {
			ContextHolder.setGlobalState(config, undefined);
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
		if (newValue === null) {
			ContextHolder.setWorkspaceState(config, undefined);
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
		if (type === DictType.Local) {
			try {
				const fsPath = DictSettings.getLocalDictPath(name);
				if (!fsPath) {
					dictTree?.getDictByName(name)?.setConnectionStatus(false);
					return;
				}
				const content = fs.readFileSync(fsPath, { encoding: 'utf8'});
				const contentObj = JSON.parse(content);
				const values: any[] = contentObj['values'];
				DictSettings.setLocalDictKeys(name, values);
				const dictNode = dictTree?.getDictByName(name);
				dictNode?.setConnectionStatus(true);
				dictTree?.refresh(dictNode);
			} catch (error) {
				console.error(error);
			}
			return;
		}
		const connectionGetter = type === DictType.RemoteURL ? remoteURLConnectionGetter : remoteUserConnectionGetter;
		const {username, apiToken, BASE_URL, gameTitle} = await connectionGetter(name);
		const dictNode = dictTree?.getDictByName(name);
		if (!username || !apiToken) {
			dictNode?.setConnectionStatus(false);
			dictTree?.refresh(dictNode);
			return;
		}
		if (gameTitle) {
			if (type === DictType.RemoteURL) {
				DictSettings.setGameTitle(name, gameTitle);
			}
			let fullURL = pathConcat(BASE_URL, "/api/querybygame/" + gameTitle);
			const req1 = axios.get(fullURL, {
				auth: {
					username: username, password: apiToken
				}
			}).then(result => {
				//console.log(result);
				if (result && gameTitle) {
                    DictSettings.setSimpleTMDictKeys(name, gameTitle, result.data);
					dictNode?.setConnectionStatus(true);
				}
			}).catch((err) => {
				const dictNode = dictTree?.getDictByName(name);
				dictNode?.setConnectionStatus(false);
				if (gameTitle) {
					DictSettings.setSimpleTMDictKeys(name, gameTitle, undefined);
				}
				console.error(err);
			});

			const req2 = axios.get(pathConcat(BASE_URL, "/api2/naming/" + gameTitle), {
				auth: {
					username: username, password: apiToken
				}
			}).then(result => {
				if (result && gameTitle) {
					DictSettings.setSimpleTMNamingRules(name, gameTitle, result.data.rules);
				}
			}).catch((err) => { 
				console.error(err);
			});
			await Promise.all([req1, req2]);
			dictTree?.refresh(dictNode);
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

	async function remoteUserConnectionGetter(dictName: string): Promise<any> {
		const username = DictSettings.getSimpleTMUsername(dictName);
		const apiToken = DictSettings.getSimpleTMApiToken(dictName);
		const BASE_URL = DictSettings.getSimpleTMUrl(dictName);
		let gameTitle = DictSettings.getGameTitle(dictName);
		return {username, apiToken, BASE_URL, gameTitle};
	}

	async function remoteURLConnectionGetter(dictName: string): Promise<any> {
		let url = DictSettings.getSimpleTMSharedURL(dictName);
		if (!url ||!url.startsWith("simpletm://")) {
			return {};
		}
		url = url.substring("simpletm://".length);
		const items = url.split('/');
		if (items.length != 5) {
			throw new Error("URL错误");
		}
		const protocal = items[0];
		const BASE_URL = `${protocal}://${items[1]}`;
		const username = items[2];
		const apiToken = items[3];
		let gameTitle = items[4];
		return {username, apiToken, BASE_URL, gameTitle};
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

				//console.log(data); // Print the parsed data

				batchUpdateLocalDictKey(dictName, data);
				vscode.commands.executeCommand('Extension.dltxt.sync_database', dictName);
        }
	}

	registerCommand(context, 'Extension.dltxt.treeview.dict.batch_insert_local', async function() {
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
		if (type == DictType.Local) {
			batchInsertLocal(name);
			return;
		}
		vscode.window.showErrorMessage('not supported');
	});


	async function updateDictRemote(name: string, rawText: string, wantDelete: boolean, connectionGetter: (dictName: string) => Promise<any>) {
		const {username, apiToken, BASE_URL, gameTitle} = await connectionGetter(name);
		if (!username || !apiToken) {
			vscode.window.showErrorMessage("请在设置中填写账号与API Token后再使用同步功能");
			return;
		}
		if (!gameTitle) {
			vscode.window.showErrorMessage("请在设置中填写项目名后再使用同步功能");
			return;
		}
		const dictNode = dictTree?.getDictByName(name);
		const oldValue = dictNode?.findEntryValue(rawText);
		let translate: string | undefined = '';
		if (!wantDelete) {
			translate = await vscode.window.showInputBox({ placeHolder: '(' + gameTitle + `)输入"${rawText}"的译文，输入空字符串删除译文，按Esc取消`, value: oldValue, ignoreFocusOut: true })	
			if (translate === undefined) {
				return; //cancelled
			}
		}

		let fullURL = "";
		var msg = "";
		if (translate) {
			msg = rawText + "->" + translate;
			fullURL = encodeURI(pathConcat(BASE_URL, "/api2/update"));
			console.log(fullURL);
			axios.post(fullURL, 
				{
					game: gameTitle,
					rawWord: rawText,
					translate: translate,
					// TODO comment: comment
				},
				{
					auth: {
						username: username, password: apiToken
					}
				}
			).then(response => {
				console.log(response.data);
				if (response.data.Result === 'True') {
					vscode.window.showInformationMessage("词条更新成功!\n" + msg);
				}
				else {
					vscode.window.showInformationMessage("unexpected json returned:\n" + response.data.Message);
					console.log(response.data);
				}
				vscode.commands.executeCommand('Extension.dltxt.sync_database', name);
			})
			.catch(error => {
				console.log(error);
				vscode.window.showInformationMessage("unexpected error:\n" + error);
			});
		} else {
			msg = "deleted: " + rawText;
			fullURL = encodeURI(pathConcat(BASE_URL, "/api2/delete"));
			vscode.window.showWarningMessage(`要删除词条"${rawText}"吗？`, '是', '否')
			.then(result => {
				if (result == '是') {
					axios.post(fullURL, {
						game: gameTitle,
						rawWord: rawText,
					},
					{
						auth: {
							username: username, password: apiToken
						}
					})
					.then(response => {
						if (response.data.Result === 'True') {
							vscode.window.showInformationMessage("词条删除成功!\n" + msg);
						}
						vscode.commands.executeCommand('Extension.dltxt.sync_database', name);
					}).catch(error => {
						vscode.window.showInformationMessage("unexpected error:\n" + error);
					});
				}
			});
		}
		
	}

	async function updateDictLocal(name: string, rawText: string, wantDelete: boolean) {
		let translate: string | undefined = '';
		const dictNode = dictTree?.getDictByName(name);
		const oldValue = dictNode?.findEntryValue(rawText);
		if (!wantDelete) {
			translate = await vscode.window.showInputBox({ placeHolder: `输入"${rawText}"的译文，输入空字符串删除译文，按Esc取消`, value: oldValue, ignoreFocusOut: true  })	
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
		if (type == DictType.Local) {
			await updateDictLocal(name, rawText, wantDelete);
		} else if (type == DictType.RemoteURL) {
			await updateDictRemote(name, rawText, wantDelete, remoteURLConnectionGetter);
		} else {
			await updateDictRemote(name, rawText, wantDelete, remoteUserConnectionGetter);
		}
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
		const dictNames = dictTree ? dictTree.getConnectedDicts() : [];
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
	registerCommand(context, 'Extension.dltxt.naming_update', async function (dictName: string, wantDelete: boolean, caller?: string, called?: string, transcaller?: string) {
		if (!dictName) {
			vscode.window.showErrorMessage("请选择一个术语库");
			return;
		}
		const type = DictSettings.getDictType(dictName);
		if (type == DictType.Local) {
			vscode.window.showErrorMessage("本地术语库暂不支持人称表");
			return;
		}
		const {username, apiToken, BASE_URL, gameTitle} = await remoteUserConnectionGetter(dictName);
		if (!username || !apiToken) {
			vscode.window.showErrorMessage("请在设置中填写账号与API Token后再使用同步功能");
			return;
		}
		if (!gameTitle) {
			vscode.window.showErrorMessage("请在设置中填写项目名后再使用同步功能");
			return;
		}
		if (!caller) {
			caller = await vscode.window.showInputBox({
				prompt: "称呼人",
				placeHolder: "留空取消",
				ignoreFocusOut: true,
			});
			if (!caller) {
				return;
			}
		}
		if (!called) {
			called = await vscode.window.showInputBox({
				prompt: "被称呼人",
				placeHolder: "留空取消",
				ignoreFocusOut: true,
			});
			if (!called) {
				return;
			}
		}
		

		if (wantDelete) {
			const res = await vscode.window.showWarningMessage(`确定要删除人称词条${called}：${called}吗`, 
				"是", "否");
			if (res != '是') {
				return;
			}
			axios.post(encodeURI(pathConcat(BASE_URL, "/api2/namingDelete")), 
				{
					game: gameTitle,
					caller,
					called
				},
				{
					auth: {
						username: username, password: apiToken
					}
				}
			).then((res) => {
				vscode.commands.executeCommand('Extension.dltxt.sync_database', dictName);
			}, (e) => {
				vscode.window.showErrorMessage(`${e}`)
			})
			return;
		}
		let fullURL = encodeURI(pathConcat(BASE_URL, "/api2/naming"));
		if (!transcaller) {
			transcaller = await vscode.window.showInputBox({
				prompt: "被称呼人的翻译",
				placeHolder: "可留空",
				ignoreFocusOut: true,
			});
			if (!transcaller) {
				transcaller = '';
			}
		}
		axios.post(fullURL, 
			{
				game: gameTitle,
				caller,
				called,
				transcaller
			},
			{
				auth: {
					username: username, password: apiToken
				}
			}
		).then((res) => {
			vscode.commands.executeCommand('Extension.dltxt.sync_database', dictName);
		}, (e) => {
			vscode.window.showErrorMessage(`${e}`)
		})
	});
	registerCommand(context, `Extension.dltxt.writeKeyword`, async　function (args) {
		let index = args.index;
		writeKeywordTranslation(index);
	});
	vscode.commands.executeCommand('Extension.dltxt.sync_all_database');
}

async function writeKeywordTranslation(index: number) {
	let activeEditor = vscode.window.activeTextEditor;
	if (!dictTree || !activeEditor || !activeEditor.selection.active) {
		return;
	}
	const currentLineNumber = activeEditor.selection.active.line;
	const decos = getDecorationsOnLine(activeEditor.document.uri, currentLineNumber - 1); // TODO: now assuming jp is one line above zh
	if (index >= decos.length) {
		vscode.window.showErrorMessage('索引越界');
		return;
	}
	const deco = decos[index];
	let s = deco.__dltxt.new_text as string;
	if (s.includes('/')) {
		const words = s.split('/');
		const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
		qp.items = words.map(w => ({ label: w }));
		qp.placeholder = '选择要插入的内容';
		qp.onDidChangeValue(value => {
			// Filter items based on input value (case-insensitive)
			qp.items = words
				.filter(w => w.toLowerCase().includes(value.toLowerCase()))
				.map(w => ({ label: w }));
		});
		qp.onDidAccept(() => {
			const selected = qp.selectedItems[0];
			if (selected) {
				editorWriteString(selected.label);
			}
			qp.hide();
			qp.dispose();
		});
		qp.show();

	} else {
		editorWriteString(s);
	}
}


export const DecorationMemoryStorage: Map<string, any> = new Map();

export function getDecorationsOnLine(uri: vscode.Uri, line: number): any[] {
	if (!dictTree) {
		return [];
	}
	const result = [];
	const dictNames = dictTree.getConnectedDicts();
	for (const dictName of dictNames) {
		const decoID = `${uri.fsPath}::${dictName}`;
		const decos = DecorationMemoryStorage.get(decoID);
		if (!decos) {
			continue;
		}
		for (const deco of decos) {
			if (deco.range.start.line == line) {
				result.push(deco);
			}
		}
	}
	return result.sort((a, b) => {
		return a.range.start.character - b.range.start.character;
	});
}

export function getDecorationsOnAllLines(uri: vscode.Uri): Map<number, any[]> {
	const res = new Map<number, any[]>();
	if (!dictTree) {
		return res;
	}
	const dictNames = dictTree.getConnectedDicts();
	for (const dictName of dictNames) {
		const decoID = `${uri.fsPath}::${dictName}`;
		const decos = DecorationMemoryStorage.get(decoID);
		if (!decos) {
			continue;
		}
		for (const deco of decos) {
			const line = deco.range.start.line;
			if (!res.has(line)) {
				res.set(line, []);
			}
			res.get(line)?.push(deco);
		}
	}
	return res;
}

export function updateKeywordDecorations() {

    let activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }

	const dictNames = DictSettings.getAllDictNames();
	for (const dictName of dictNames) {
		const {deco, oldDeco, changed} = DictSettings.getDictDecoration(dictName);
		const namingDecoType = DictSettings.getNamingDecoration(dictName);
		const keywordsDecos: vscode.DecorationOptions[] = [];
		const type = DictSettings.getDictType(dictName);
		const showHighLight = DictSettings.getStyleShow(dictName);
		const decoID = `${activeEditor.document.uri.fsPath}::${dictName}`;
		if (!showHighLight) {
			if (oldDeco) {
				activeEditor.setDecorations(oldDeco, []);
			}
			if (deco) {
				activeEditor.setDecorations(deco, []);
			}
			namingDecoType && activeEditor.setDecorations(namingDecoType, []);
			continue;
		}
		if (changed && oldDeco) {
			activeEditor.setDecorations(oldDeco, []);
		}

		let keywords = [];
		let naming: any = {};
		if (type === DictType.Local) {
			keywords = DictSettings.getLocalDictKeys(dictName);
		} else if (type == DictType.RemoteUser || type == DictType.RemoteURL) {
			let game : string | undefined = DictSettings.getGameTitle(dictName);
			if (!game) {
				continue;
			}
			keywords = DictSettings.getSimpleTMDictKeys(dictName, game);
			naming = DictSettings.getSimpleTMNamingRules(dictName, game);
		}
		const testArray: Array<String> = [];
		for (let i = 0; i < keywords.length; i++) {
			let v = keywords[i];
			let vr = String(v['raw']);
			if(vr)
				testArray.push(vr);
		}
		if (testArray.length > 0) {
			let dict = new Map<String, string>();
			const comments = new Map<String, string>();
			keywords.forEach(v => {
				dict.set(v['raw'], v['translate']);
				if (v['comment']) {
					comments.set(v['raw'], v['comment']);
				}
			});

			const text = activeEditor.document.getText();

			const ac = new AhoCorasick(testArray);
			const results = ac.search(text) as any[];
			for (let res of results) {
				const endIndex = res[0];
				const keywords = res[1];
				for (let keyword of keywords) {
					const index = endIndex + 1 - keyword.length;
					const startPos = activeEditor.document.positionAt(index);
					const endPos = activeEditor.document.positionAt(index + keyword.length);
					const word = dict.get(keyword)?.replace(/"/g, '') as string;
					const originalWord = keyword.replace(/"/g, '') as string;
					const copyCommand = `[copy](command:Extension.dltxt.copyToClipboard?{"text":"${encodeURIComponent(word)}"})`;
					const replaceCommand = `[replace](command:Extension.dltxt.replaceAllInLine?{"old_text":"${encodeURIComponent(originalWord)}","new_text":"${encodeURIComponent(word)}","line":${startPos.line}})`;
					const comment = comments.has(originalWord) ? ` 备注：${comments.get(originalWord)}` : '';
					const hoverMarkdown = new vscode.MarkdownString(`${word} ${copyCommand} ${replaceCommand}${comment}`);
					hoverMarkdown.isTrusted = true;
					const decoration = {
						range: new vscode.Range(startPos, endPos),
						hoverMessage: hoverMarkdown,
						renderOptions: {},
						__dltxt: {
							old_text: originalWord,
							new_text: word
						}
					};
					keywordsDecos.push(decoration);
				}
			}
			activeEditor.setDecorations(deco, keywordsDecos);
		}
		

		const namingDecos: vscode.DecorationOptions[] = [];
		if (Object.keys(naming).length > 0) {
			const testArrays = new Map<string, string[]>(); // caller -> called[]
			for (const caller in naming) {
				const testArray: string[] = [];
				for(const called in naming[caller]) {
					testArray.push(called);
				}
				testArrays.set(caller, testArray);
			}
			const allCalleds = new Set<string>();
			for (const caller in naming) {
				for (const called in naming[caller]) {
					allCalleds.add(called);
				}
			}
			const allCalledArray = Array.from(allCalleds);
			const lineNumberToTalker = new Map<number, string>();
			DocumentParser.processPairedLines(activeEditor.document, (jgrps, cgrps, j_index, c_index, talkingName) => {
				if (talkingName) {
					lineNumberToTalker.set(j_index, talkingName);
					lineNumberToTalker.set(c_index, talkingName);
				}
			});
			const ac = new AhoCorasick(allCalledArray);
			const results = ac.search(activeEditor.document.getText()) as any[];
			for (const res of results) {
				const endIndex = res[0];
				const keywords = res[1];
				for (const keyword of keywords) {
					const index = endIndex + 1 - keyword.length;
					const startPos = activeEditor.document.positionAt(index);
					const endPos = activeEditor.document.positionAt(index + keyword.length);
					const talkingName = lineNumberToTalker.get(startPos.line);
					if (!talkingName) {
						continue;
					}
					const trans = naming[talkingName][keyword]?.replace(/"/g, '') as string;
					const called = keyword.replace(/"/g, '') as string;
					const copyCommand = `[copy](command:Extension.dltxt.copyToClipboard?{"text":"${encodeURIComponent(trans)}"})`;
					const replaceCommand = `[replace](command:Extension.dltxt.replaceAllInLine?{"old_text":"${encodeURIComponent(called)}","new_text":"${encodeURIComponent(trans)}","line":${startPos.line}})`;
					const hoverMarkdown = new vscode.MarkdownString(`${trans} ${copyCommand} ${replaceCommand}`);
					hoverMarkdown.isTrusted = true;
					const decoration = {
						range: new vscode.Range(startPos, endPos),
						hoverMessage: hoverMarkdown,
						renderOptions: {},
						__dltxt: {
							old_text: called,
							new_text: trans
						}
					}
					namingDecos.push(decoration);
				}
			}
			if (namingDecoType) {
				activeEditor.setDecorations(namingDecoType, namingDecos);
			}
		}

		DecorationMemoryStorage.set(decoID, keywordsDecos.concat(namingDecos));
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
			const key = String(kv.key);
			const value = String(kv.value);
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
			url = 'https://simpletm.jscrosoft.com';
		}
		const name = 'remote-dictionary';
		const allDicts = DictSettings.getAllDictNames();
		if (allDicts.includes(name)) {
			return;
		}
		allDicts.push(name);
		await DictSettings.setAllDictNames(allDicts);
		dictTree?.addRemoteUserDict(name, {url: url, user: user, api: api, game: game});
		vscode.commands.executeCommand('Extension.dltxt.sync_all_database');
	}
}