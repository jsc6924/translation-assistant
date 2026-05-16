import * as vscode from 'vscode'
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { parse, ParseError, printParseErrorCode } from 'jsonc-parser/lib/esm/main';
import { dict_view } from './treeview';
import { registerCommand, DictSettings, ContextHolder, DictType, pathConcat, DictKeyInfo, getCurrentWorkspaceFolder, DictNamingRule, DictNamingValue, getDictNamingComment, getDictNamingTranslation } from './utils';
import { editorWriteString, translateCurrentLine } from './motion';
import { DocumentParser } from './parser';
import { ProjectNamingUpdatedNotification, ProjectTranslationUpdatedNotification, subscribeProjectNotifications } from './lspclient';
import { updateKeywordDecorations } from './decoration';
const AhoCorasick = require('ahocorasick');


export const SimpleTMDefaultURL = "https://simpletm.jscrosoft.com";

export let dictTree: dict_view.DictTreeView | undefined = undefined; 
export const autoSyncVSCodeSettingsConfigName = "dltxt.config.autoSyncVSCodeSettings";
export const ignoredVSCodeSettingsConfigName = "dltxt.config.ignoredVSCodeSettingsForSync";

let activePullMode = true;
export const isActivePullMode = () => activePullMode;
export function setActivePullMode(value: boolean) {
	activePullMode = value;
}

let lastPullTime = 0;
const lazyPullInterval = 60 * 60 * 1000; // 1 hours

export function activate(context: vscode.ExtensionContext) {
	const configInit = vscode.workspace.getConfiguration("dltxt");

    const syncInterval = configInit.get("simpleTM.syncInterval") as number;
	if (syncInterval > 0) {
		let syncIntervalMS = Math.max(syncInterval, 30) * 1000;
		setInterval(() => {
			const config = vscode.workspace.getConfiguration("dltxt");
			if (vscode.window.activeTextEditor && config.get("simpleTM.project")) {
				const now = Date.now();
				if (activePullMode || now - lastPullTime > lazyPullInterval) {
					vscode.commands.executeCommand('Extension.dltxt.sync_all_database');
					lastPullTime = now;
				}
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

	registerCommand(context, 'Extension.dltxt.treeview.dict.reloadDict', async (item: dict_view.DictRootItem) => {
		if (!item) {
			return;
		}
		await vscode.commands.executeCommand('Extension.dltxt.sync_database_with_vscode_config', item.dictName);
		const config = vscode.workspace.getConfiguration();
		if (config.get(autoSyncVSCodeSettingsConfigName)) {
			vscode.window.showInformationMessage(`术语库${item.dictName}已重新加载并同步VSCode设置`);
		} else {
			vscode.window.showInformationMessage(`术语库${item.dictName}已重新加载(未同步VSCode设置)`);
		}
	});

	registerCommand(context, 'Extension.dltxt.treeview.dict.removeDict', async (item: dict_view.DictRootItem) => {
		const res = await vscode.window.showWarningMessage(`确定要移除术语库${item.dictName}吗（仅从列表移除，不会删除术语库）？`, 
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

	registerCommand(context, 'Extension.dltxt.sync_database', async function (name: string) {
		await syncDatabase(name);
		updateKeywordDecorations();
	});

	registerCommand(context, 'Extension.dltxt.sync_database_with_vscode_config', async function (name: string) {
		await syncDatabase(name);
		await syncVscodeConfig(name);
		updateKeywordDecorations();
	});

	registerCommand(context, 'Extension.dltxt.sync_database_by_game_title', async function (gameTitle: string) {
		await syncDatabaseByGameTitle(gameTitle);
	});


	registerCommand(context, 'Extension.dltxt.sync_all_database', async function () {
		const dictNames = DictSettings.getAllDictNames();
		for (const name of dictNames) {
			await syncDatabase(name);
			await syncVscodeConfig(name);
		}
		updateKeywordDecorations();
	});

	registerCommand(context, 'Extension.dltxt.upload_workspace_vscode_settings', async function (name?: string) {
		await uploadWorkspaceVSCodeSettings(name);
	});


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

// handle insert/uodate/delete of a single key in local dict
export async function updateDatabaseTranslationByGameTitle(gameTitle: string, params: ProjectTranslationUpdatedNotification, isDelete: boolean): Promise<void> {
	const dictNames = DictSettings.getAllDictNames();
	for (const name of dictNames) {
		const dictGameTitle = DictSettings.getGameTitle(name);
		if (dictGameTitle === gameTitle) {
			await updateDatabaseTranslationByDictName(name, params, false, isDelete);
		}
	}
	updateKeywordDecorations();
}

// handle insert/uodate/delete of a single key in local dict
export async function updateDatabaseTranslationByDictName(name: string, params: ProjectTranslationUpdatedNotification, updateDecoration: boolean, isDelete: boolean): Promise<void> {
	const type = DictSettings.getDictType(name);
	if (type === DictType.Local) {
		// skip local dict as this update comes from a remote server. 
		return;
	}
	const dictNode = dictTree?.getDictByName(name);
	if (!dictNode) {
		return;
	}
    if (!dictNode.getConnectionStatus()) {
		await syncDatabase(name);
	}

	const connectionGetter = type === DictType.RemoteURL ? remoteURLConnectionGetter : remoteUserConnectionGetter;
	const {gameTitle} = await connectionGetter(name);
	const contents = DictSettings.getSimpleTMDictKeys(name, gameTitle);
	if (isDelete) {
		if (contents) {
			const index = contents.findIndex((k: DictKeyInfo) => k.raw === params.key);
			if (index >= 0) {
				contents.splice(index, 1);
			}
		}
	} else {
		if (contents) {
			const index = contents.findIndex((k: DictKeyInfo) => k.raw === params.key);
			if (index >= 0) { 
				//update
				contents[index].translate = params.value ?? '';
				contents[index].comment = params.comment ?? '';
			} else {
				// insert
				contents.push({
					raw: params.key, 
					translate: params.value ?? '',
					comment: params.comment ?? '',
				});
			}
		}
	}
	DictSettings.setSimpleTMDictKeys(name, gameTitle, contents);

	dictTree?.refresh(dictNode);

	if (updateDecoration) {
		updateKeywordDecorations();
	}
}

export async function updateDatabaseNamingByGameTitle(gameTitle: string, params: ProjectNamingUpdatedNotification, isDelete: boolean): Promise<void> {
	const dictNames = DictSettings.getAllDictNames();
	for (const name of dictNames) {
		const dictGameTitle = DictSettings.getGameTitle(name);
		if (dictGameTitle === gameTitle) {
			await updateDatabaseNamingByDictName(name, params, false, isDelete);
		}
	}
	updateKeywordDecorations();
}

export async function updateDatabaseNamingByDictName(name: string, params: ProjectNamingUpdatedNotification, updateDecoration: boolean, isDelete: boolean): Promise<void> {
	const type = DictSettings.getDictType(name);
	if (type === DictType.Local) {
		// skip local dict as this update comes from a remote server. 
		return;
	}
	const dictNode = dictTree?.getDictByName(name);
	if (!dictNode) {
		return;
	}
    if (!dictNode.getConnectionStatus()) {
		await syncDatabase(name);
	}

	const connectionGetter = type === DictType.RemoteURL ? remoteURLConnectionGetter : remoteUserConnectionGetter;
	const {gameTitle} = await connectionGetter(name);
	let rules = DictSettings.getSimpleTMNamingRules(name, gameTitle);
	if (isDelete) {
		if (rules) {
			if (params.caller && params.called) {
				if (rules[params.caller]) {
					delete rules[params.caller][params.called];
					if (Object.keys(rules[params.caller]).length == 0) {
						delete rules[params.caller];
					}
				}
			} else if (params.caller) {
				// delete all called for this caller
				delete rules[params.caller];
			}
		}
	} else {
		if (!rules) {
			rules = {};
		}
		if (params.caller && params.called) {
			if (!rules[params.caller]) {
				rules[params.caller] = {};
			}
			rules[params.caller][params.called] = {
				transcaller: params.transcaller ?? '',
				comment: params.comment,
			};
		}
	}
	DictSettings.setSimpleTMNamingRules(name, gameTitle, rules);
	dictTree?.refresh(dictNode);
	if (updateDecoration) {
		updateKeywordDecorations();
	}
}

export async function syncDatabase(name: string) {
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

		try {
			await subscribeProjectNotifications(gameTitle);
			console.log(`Subscribed to project ${gameTitle} via SimpleTM websocket`);
		} catch (error) {
			console.error(error);
		}
	}
}

async function syncVscodeConfig(name: string) {
	const config = vscode.workspace.getConfiguration();
	const dictNode = dictTree?.getDictByName(name);
	if (!dictNode) {
		return;
	}
	const type = DictSettings.getDictType(name);
	if (type === DictType.Local) {
		return;
	}
	if (!config.get(autoSyncVSCodeSettingsConfigName)) {
		return;
	}
	const connectionGetter = type === DictType.RemoteURL ? remoteURLConnectionGetter : remoteUserConnectionGetter;
	const {username, apiToken, BASE_URL, gameTitle} = await connectionGetter(name);
	if (!username || !apiToken) {
		vscode.window.showErrorMessage("请在设置中填写账号与API Token后再使用同步功能");
		return;
	}
	if (!gameTitle) {
		vscode.window.showErrorMessage("请在设置中填写项目名后再使用同步功能");
		return;
	}
	const fullURL = pathConcat(BASE_URL, "/api2/vscodeConfig/" + gameTitle);
	const req1 = axios.get(fullURL, {
		auth: {
			username: username, password: apiToken
		}
	}).then(result => {
		if (result && result.data) {
			const config = vscode.workspace.getConfiguration();
			for (const key in result.data) {
				if (key === autoSyncVSCodeSettingsConfigName) {
					continue;
				}
				const value = result.data[key];
				config.update(key, value, vscode.ConfigurationTarget.Workspace);
			}
		}
	}).catch((err) => {
		console.error(err);
	});
}

function getIgnoredVSCodeSettingsForSync(): string[] {
	const config = vscode.workspace.getConfiguration();
	const ignored = config.get<string[]>(ignoredVSCodeSettingsConfigName) ?? [];
	return Array.from(new Set([autoSyncVSCodeSettingsConfigName, ...ignored]));
}

function getFilteredWorkspaceVSCodeSettings(): Record<string, unknown> {
	const workspaceFolder = getCurrentWorkspaceFolder();
	if (!workspaceFolder) {
		throw new Error('当前没有打开工作区文件夹');
	}

	const settingsPath = path.join(workspaceFolder, '.vscode', 'settings.json');
	if (!fs.existsSync(settingsPath)) {
		return {};
	}

	const rawText = fs.readFileSync(settingsPath, 'utf8');
	const errors: ParseError[] = [];
	const parsed = parse(rawText, errors, {
		allowTrailingComma: true,
		disallowComments: false,
	});

	if (errors.length > 0) {
		const details = errors.map(err => printParseErrorCode(err.error)).join(', ');
		throw new Error(`无法解析工作区设置: ${details}`);
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('工作区设置必须是一个 JSON 对象');
	}

	const ignored = new Set(getIgnoredVSCodeSettingsForSync());
	return Object.fromEntries(
		Object.entries(parsed as Record<string, unknown>).filter(([key]) => !ignored.has(key))
	);
}

async function pickRemoteDictName(): Promise<string | undefined> {
	const remoteDicts = DictSettings.getAllDictNames().filter(name => DictSettings.getDictType(name) !== DictType.Local);
	if (remoteDicts.length === 0) {
		vscode.window.showInformationMessage('需要先连接远程术语库');
		return undefined;
	}
	if (remoteDicts.length === 1) {
		return remoteDicts[0];
	}
	return await vscode.window.showQuickPick(remoteDicts, {
		canPickMany: false,
		placeHolder: '选择一个远程术语库上传工作区设置'
	});
}

export async function uploadWorkspaceVSCodeSettings(name?: string): Promise<void> {
	const dictName = name ?? await pickRemoteDictName();
	if (!dictName) {
		return;
	}

	const dictNode = dictTree?.getDictByName(dictName);
	if (!dictNode) {
		return;
	}

	const type = DictSettings.getDictType(dictName);
	if (type === DictType.Local) {
		vscode.window.showErrorMessage('本地术语库不支持上传工作区设置');
		return;
	}

	const connectionGetter = type === DictType.RemoteURL ? remoteURLConnectionGetter : remoteUserConnectionGetter;
	const {username, apiToken, BASE_URL, gameTitle} = await connectionGetter(dictName);
	if (!username || !apiToken) {
		vscode.window.showErrorMessage('请在设置中填写账号与API Token后再使用同步功能');
		return;
	}
	if (!gameTitle) {
		vscode.window.showErrorMessage('请在设置中填写项目名后再使用同步功能');
		return;
	}

	let filteredSettings: Record<string, unknown>;
	try {
		filteredSettings = getFilteredWorkspaceVSCodeSettings();
	} catch (error) {
		vscode.window.showErrorMessage(`${error}`);
		return;
	}

	const payload = JSON.stringify(filteredSettings);
	if (Buffer.byteLength(payload, 'utf8') > 64 * 1024) {
		vscode.window.showErrorMessage('工作区设置过大，无法上传（最大 64KB）');
		return;
	}

	const fullURL = pathConcat(BASE_URL, '/api2/vscodeConfig/' + gameTitle);
	try {
		await axios.post(fullURL, filteredSettings, {
			auth: {
				username: username,
				password: apiToken
			},
			headers: {
				'Content-Type': 'application/json'
			}
		});
		vscode.window.showInformationMessage(`已上传当前工作区设置到 ${gameTitle}`);
	} catch (error) {
		console.error(error);
		vscode.window.showErrorMessage(`上传工作区设置失败: ${error}`);
	}
}

async function syncDatabaseByGameTitle(gameTitle: string) {
	const dictNames = DictSettings.getAllDictNames();
	for (const name of dictNames) {
		const dictGameTitle = DictSettings.getGameTitle(name);
		if (dictGameTitle === gameTitle) {
			await syncDatabase(name);
			await syncVscodeConfig(name);
		}
	}
	updateKeywordDecorations();
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