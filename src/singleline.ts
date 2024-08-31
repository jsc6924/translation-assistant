import * as vscode from 'vscode'
import { registerCommand } from './utils';
import * as utils from './utils';
import * as fs from "fs"; 
import * as path from "path";
import { DocumentParser } from './parser';
export function activate(context: vscode.ExtensionContext) {
    	
	registerCommand(context, 'Extension.dltxt.extract_single_line', async () => {
		const document = vscode.window.activeTextEditor?.document;
		if (!document) return;
		const filePath: string = vscode.window.activeTextEditor?.document.uri.fsPath as string;
		if (!filePath) return;

		const [_, diagnostics] = DocumentParser.errorCheck(document);
		if (diagnostics.length > 0) {
			throw new Error(`文本格式错误: ${diagnostics[0].message} line=${diagnostics[0].range.start.line+1}`);
		}

		const dirPath = path.dirname(filePath);
		const fileName = path.basename(filePath);
		const tempDirPath = dirPath + '\\.dltxt'
		if (!fs.existsSync(tempDirPath)) {
			fs.mkdirSync(tempDirPath);
		}
		const lines: string[] = [];
		DocumentParser.processTranslatedLines(document, (groups, i) => {
			lines.push(document.lineAt(i).text);
		})
		const slFilePath = tempDirPath + '\\' + fileName + '.sl';
		const data = lines.join('\r\n');
		fs.writeFileSync(slFilePath, data);
		let setting: vscode.Uri = vscode.Uri.file(slFilePath);
		
		const d = await vscode.workspace.openTextDocument(setting)
		vscode.window.showTextDocument(d, vscode.ViewColumn.Beside, false);

	});

	async function merge_into_double_line(deleleTemp: boolean) {
		if (!vscode.window.activeTextEditor) {
			vscode.window.showErrorMessage('请先选中需要更改的双行文本');
			return;
		}
		let curFilePath: string = vscode.window.activeTextEditor?.document.uri.fsPath as string;
		let dlFilePath: string;
		let slFilePath: string;
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
		
		const replacedLines = fs.readFileSync(slFilePath, 'utf8').split(/\r?\n/);
		let dlDocument = dlEditor.document;

		const [showError, diagnostics] = DocumentParser.errorCheck(dlDocument);
		if (diagnostics.length > 0) {
			throw new Error(`文本格式错误 ${dlFilePath}: ${diagnostics[0].message} line=${diagnostics[0].range.start.line+1}`);
		}

		await dlEditor?.edit(editBuilder => {
			let j = 0;
			DocumentParser.processTranslatedLines(dlEditor.document, (groups, i) => {
				const line = dlDocument.lineAt(i);
				editBuilder.replace(line.range, replacedLines[j++]);
			})
		});

		if (deleleTemp) {
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			fs.unlinkSync(slFilePath);
		}
		vscode.window.showInformationMessage(`应用成功`);
	}
	
	registerCommand(context, 'Extension.dltxt.merge_into_double_line', async function(){
		await merge_into_double_line(false);
	});

	registerCommand(context, 'Extension.dltxt.merge_into_double_line_del_temp', async () => {
		await merge_into_double_line(true);
	});

	
	
}