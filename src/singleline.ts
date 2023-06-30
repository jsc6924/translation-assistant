import * as vscode from 'vscode'
import { registerCommand } from './utils';
import * as utils from './utils';
import * as fs from "fs"; 
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
    	
	registerCommand(context, 'Extension.dltxt.extract_single_line', () => {
		const document = vscode.window.activeTextEditor?.document;
		if (!document) return;
		const filePath: string = vscode.window.activeTextEditor?.document.uri.fsPath as string;
		if (!filePath) return;
        
        const configInit = vscode.workspace.getConfiguration("dltxt");
        const translatedPrefixRegex = configInit.get('core.translatedTextPrefixRegex');
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
				vscode.workspace.openTextDocument(setting)
					.then((d: vscode.TextDocument) => {
						vscode.window.showTextDocument(d, vscode.ViewColumn.Beside, false);
					}, (err) => {
						console.error(err);
					});
			});
		
	});

	async function merge_into_double_line(deleleTemp: boolean) {
		if (!vscode.window.activeTextEditor) {
			vscode.window.showErrorMessage('请先选中需要更改的双行文本');
			return;
		}
		let curFilePath: string = vscode.window.activeTextEditor?.document.uri.fsPath as string;
		let dlFilePath: string;
		let slFilePath: string;
		let refFilePath: string;
		const m = curFilePath.match(/(.*)\.dltxt\\(.*)\.sl/);
		if (!m) {
			vscode.window.showErrorMessage('当前编辑器中打开的不是单行文本');
			return;
		}
		dlFilePath = path.join(m[1], m[2]);
		slFilePath = curFilePath;
		const dlEditor = utils.findEditorByUri(vscode.Uri.file(dlFilePath));
		if (!dlEditor || !dlEditor?.document)
		{
			vscode.window.showErrorMessage('请先打开需要更改的双行文本');
			return;
		}
		if (path.join(dlEditor.document.uri.fsPath) != dlFilePath) {
			vscode.window.showErrorMessage('所选中的双行文本与当前单行文本不匹配');
			return;
		}
		await vscode.window.activeTextEditor.document.save();
		refFilePath = `${m[1]}.dltxt\\${m[2]}.ref`;
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
		await dlEditor?.edit(editBuilder => {
			let j = 0;
			for (let i = 0; i < dlDocument.lineCount; i++) {
				const line = dlDocument.lineAt(i);
				if (prefixReg.test(line.text)) {
					editBuilder.replace(line.range, replacedLines[j++]);
				}
			}
		});

		if (deleleTemp) {
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			fs.unlinkSync(slFilePath);
			fs.unlinkSync(refFilePath);
		}
		vscode.window.showInformationMessage(`应用成功`);
	}
	
	registerCommand(context, 'Extension.dltxt.merge_into_double_line', async function(){
		merge_into_double_line(false);
	});

	registerCommand(context, 'Extension.dltxt.merge_into_double_line_del_temp', async () => {
		merge_into_double_line(true);
	});
	
}