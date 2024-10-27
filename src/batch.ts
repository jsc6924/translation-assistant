import * as vscode from 'vscode'
import { registerCommand } from './utils';
import * as utils from './utils';
import * as fs from "fs"; 
import * as path from "path";
import { DocumentParser } from './parser';
import { channel } from './dlbuild';
import { performance } from 'perf_hooks';
import { createDiagnostic, ErrorCode, filterUntranslatedLines, warningCheck } from './error-check';
import { insert_newline_for_line } from './newline';


async function batchProcess(documentUris: vscode.Uri[], cb: (doc: vscode.TextDocument) => void) {
    const total_file = documentUris.length;
    channel.show();
    channel.appendLine(`已处理 0/${total_file}\n`);
    const startTime = performance.now();

    for (let i = 0; i < documentUris.length;) {
        const tasks = [];
        // batch size = 100时，处理速度比=1时快约4倍
        const batch_size = Math.min(100, documentUris.length - i);
        for(let j = 0; j < batch_size; j++) {
            const uri = documentUris[i + j];
            const task = vscode.workspace.openTextDocument(uri).then((doc) => {
                try {
                    cb(doc);
                } catch (e) {
                    channel.appendLine(`Error processing ${uri.fsPath}: ${e}`);
                }
            });
            
            tasks.push(task);
        }
        await Promise.all(tasks);
        i += batch_size;
        channel.appendLine(`已处理 ${i}/${total_file}`);
    }
    
    const endTime = performance.now();
    const executionTime = endTime - startTime;
    channel.appendLine(`Execution Time: ${executionTime.toFixed(2)} ms`);
}

export async function selectBatchRange(undoable: boolean, ext?: string): Promise<vscode.Uri[] | undefined> {
    const convertRange = ['所有打开的文件', '当前目录下所有文件', '当前目录下所有文件（不包含子目录）'];
    // Show encoding selection menu
    const selectedRange = await vscode.window.showQuickPick(convertRange, {
        placeHolder: '选择转换范围',
    });
    if (!selectedRange) {
        return;
    }
    const globAllFilesHelper = async (pattern: string) => {
        if (!undoable) {
            const userInput = await vscode.window.showInputBox({
                prompt: '当前操作不可撤销，请确保已经备份。输入字母y继续，否则将取消操作'
    
            });
            if (userInput?.toLowerCase() != "y") {
                return;
            }
        }
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage('当前没有打开的文件夹');
            return;
        }

        // Specify the file search pattern to match all files
        const filePattern = ext ? `${pattern}.${ext}` : `${pattern}`;
        const excludePattern = '**/.*/**'

        // Search for all files in the workspace folder
        return await vscode.workspace.findFiles(filePattern, excludePattern, undefined, undefined);
    }
    if (selectedRange === '当前目录下所有文件') {
        return globAllFilesHelper("**/*");

    } else if (selectedRange === '当前目录下所有文件（不包含子目录）') {
        return globAllFilesHelper("*");
    } else {
        const res = [] as vscode.Uri[];
        vscode.window.tabGroups.all.forEach(tabGroup => {
            tabGroup.tabs.forEach(tab => {
                if (tab.input instanceof vscode.TabInputText) {
                    res.push(tab.input.uri);
                }
            });
        });
        if (ext) {
            return filterFilesByGlobExt(res, ext);
        }
        return res;
    }
}

function filterFilesByGlobExt(files: vscode.Uri[], ext: string) {
    const m = /\{(.+)\}/.exec(ext);
    let exts = [] as string[];
    if (m && m[1]) {
        exts = m[1].split(',');
    } else {
        exts = [ext];
    }
    return files.filter(file => {
        const fileExt = path.extname(file.fsPath).slice(1);
        return exts.includes(fileExt);
    });
}

async function batch_check(documentUris: vscode.Uri[]) {
    // replace text in all selected files, using workspace edit
    const total_file = documentUris.length;
    let file_checked = 0;

    await batchProcess(documentUris, doc => {
        const [diags, untranslatedLines] = warningCheck(doc);
        utils.DltxtDiagCollection.set(doc.uri, diags);

        const missinglineDiags = untranslatedLines.map(line => {
            const d = createDiagnostic(vscode.DiagnosticSeverity.Warning, '未翻译', line, 0, 1000);
            return d;
        });
        utils.DltxtDiagCollectionMissionLine.set(doc.uri, missinglineDiags);

        file_checked++;
    });

    vscode.window.showInformationMessage(`已检查 ${file_checked}/${total_file} 个文件`);
}

async function batch_insert_newline(documentUris: vscode.Uri[]) {
    const config = vscode.workspace.getConfiguration("dltxt");
    const newline = config.get<string>('nestedLine.token');
    if (!newline) {
        vscode.window.showErrorMessage('请先设置换行符');
        return;
    }
    const maxlen = config.get<number>('nestedLine.maxLen');
    if (!maxlen || maxlen < 0) {
        vscode.window.showErrorMessage('请先设置每行最大字数');
        return;
    }

    const escapedNewline = newline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const deleteNewlineRegex = new RegExp(`${escapedNewline}[\\s　]*`, 'g');

    const workspaceEdit = new vscode.WorkspaceEdit();
    const total_file = documentUris.length;
    let file_processed = 0;
    await batchProcess(documentUris, doc => {
        DocumentParser.processTranslatedLines(doc, (groups, i) => {
            const target = groups.white + groups.text + groups.suffix;
            const insertNewline = newline + utils.repeatStr('　', groups.white.length, false);
            const replaced = insert_newline_for_line(target, insertNewline, deleteNewlineRegex, maxlen);
            if (replaced != target) {
                const line = doc.lineAt(i);  
                const start = line.range.start.with({ character: groups.prefix.length });
                const end = line.range.end;
                workspaceEdit.replace(doc.uri, new vscode.Range(start, end), replaced);
            }
        });
        file_processed++;
    });
    await vscode.workspace.applyEdit(workspaceEdit);
    vscode.window.showInformationMessage(`已处理 ${file_processed}/${total_file} 个文件`);
}

async function batch_reomve_newline(documentUris: vscode.Uri[]) {
    const config = vscode.workspace.getConfiguration("dltxt");
    const newline = config.get<string>('nestedLine.token');
    if (!newline) {
        vscode.window.showErrorMessage('请先设置换行符');
        return;
    }

    const escapedNewline = newline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const deleteNewlineRegex = new RegExp(`${escapedNewline}[\\s　]*`, 'g');

    const workspaceEdit = new vscode.WorkspaceEdit();
    const total_file = documentUris.length;
    let file_processed = 0;
    await batchProcess(documentUris, doc => {
        DocumentParser.processTranslatedLines(doc, (groups, i) => {
            const target = groups.white + groups.text + groups.suffix;
            const insertNewline = newline + utils.repeatStr('　', groups.white.length, false);
            deleteNewlineRegex.lastIndex = 0;
            const replaced = target.replace(deleteNewlineRegex, '');
            if (replaced != target) {
                const line = doc.lineAt(i);  
                const start = line.range.start.with({ character: groups.prefix.length });
                const end = line.range.end;
                workspaceEdit.replace(doc.uri, new vscode.Range(start, end), replaced);
            }
        });
        file_processed++;
    });
    await vscode.workspace.applyEdit(workspaceEdit);
    vscode.window.showInformationMessage(`已处理 ${file_processed}/${total_file} 个文件`);
}


export async function batchCheckCommand() {
    const documentUris = await selectBatchRange(true, '{txt,TXT}');
    if (!documentUris) {
        return;
    }
    await batch_check(documentUris);
}

export async function batchInsertNewline() {
    const documentUris = await selectBatchRange(true, '{txt,TXT}');
    if (!documentUris) {
        return;
    }
    await batch_insert_newline(documentUris);
}

export async function batchRemoveNewline() {
    const documentUris = await selectBatchRange(true, '{txt,TXT}');
    if (!documentUris) {
        return;
    }
    await batch_reomve_newline(documentUris);
}


export function activate(context: vscode.ExtensionContext) {
    registerCommand(context, 'Extension.dltxt.batch_replace', async () => {
		const document = vscode.window.activeTextEditor?.document;
		if (!document) return;
		// get raw text from current selection
		const rawText = document.getText(vscode.window.activeTextEditor?.selection);
		if (!rawText) {
			return;
		}
		const replaced = await vscode.window.showInputBox({ placeHolder: '输入替换的文本' });
		if (!replaced) {
			return;
		}
		const documentUris = await selectBatchRange(true, '{txt,TXT}');
		if (!documentUris) {
			return;
		}
		// replace text in all selected files, using workspace edit
		const workspaceEdit = new vscode.WorkspaceEdit();
		const total_file = documentUris.length;
		let success = 0, success_file = 0;

        await batchProcess(documentUris, doc => {
            const uri = doc.uri;
            let file_success = 0;
            DocumentParser.processTranslatedLines(doc, (groups, i) => {
                const line = doc.lineAt(i);
                const text = line.text;
                if (text.includes(rawText)) {
                    const newText = text.replace(new RegExp(utils.regEscape(rawText), 'g'), replaced);
                    const newLine = new vscode.Range(line.range.start, line.range.end);
                    workspaceEdit.replace(uri, newLine, newText);
                    file_success++;
                }
            });
            if (file_success > 0) {
                success_file++;
                success += file_success;
            }
        });
		
		if(await vscode.workspace.applyEdit(workspaceEdit)) {
			vscode.window.showInformationMessage(`[${rawText}]=>[${replaced}]，成功在${success_file}/${total_file} 个文件中替换了${success} 处`);
		} else {
			vscode.window.showErrorMessage('替换失败');
		}
	});

    registerCommand(context, 'Extension.dltxt.batch_check', batchCheckCommand);

    registerCommand(context, 'Extension.dltxt.batch_check_folder', async (arg) => {
        const folderPath = arg.fsPath;
        if (!fs.statSync(folderPath).isDirectory()){
            vscode.window.showInformationMessage('请选中一个文件夹');
            return;
        }
        const globPattern = new vscode.RelativePattern(folderPath, '**/*.{txt,TXT}');
        const documentUris = await vscode.workspace.findFiles(globPattern, '**/.*/**', undefined, undefined)
		await batch_check(documentUris);
	});


}