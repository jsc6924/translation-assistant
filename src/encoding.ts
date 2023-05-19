import * as vscode from 'vscode';
import * as fs from "fs";
import * as iconv from "iconv-lite";


export async function batchConvertFilesEncoding() {
    
    const convertRange = ['所有打开的文件', '当前目录下所有文件'];
    // Show encoding selection menu
    const selectedRange = await vscode.window.showQuickPick(convertRange, {
        placeHolder: '选择转换范围',
    });
    if (!selectedRange) {
        return;
    }
    let documentUris: vscode.Uri[] = [];
    if (selectedRange === '当前目录下所有文件') {
        const userInput = await vscode.window.showInputBox({
            prompt: '当前操作不可撤销，请确保已经备份。输入字母y继续，否则将取消操作'

        });
        if (userInput?.toLowerCase() != "y") {
            return;
        }
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage('当前没有打开的文件夹');
            return;
        }

        // Specify the file search pattern to match all files
        const filePattern = '**/*';
        const excludePattern = '**/.*/**'

        // Search for all files in the workspace folder
        documentUris = await vscode.workspace.findFiles(filePattern, excludePattern, undefined, undefined);

    } else {
        documentUris = vscode.workspace.textDocuments.filter(document => !document.fileName.includes('.git'))
                        .map(document => document.uri);
    }
    // List of supported encodings
    const encodings = ['utf8', 'utf8-bom', 'utf16le', 'utf16be', 'shift-jis', 'gb2312', 'gbk'];
    // Show encoding selection menu
    const selectedSrcEncoding = await vscode.window.showQuickPick(encodings, {
        placeHolder: '选择文件原来的编码格式',
    });

    if (!selectedSrcEncoding) {
        return; // User canceled the selection
    }

    // Show encoding selection menu
    const selectedDstEncoding = await vscode.window.showQuickPick(encodings, {
        placeHolder: '选择要转换至哪种编码格式',
    });

    if (!selectedDstEncoding) {
        return; // User canceled the selection
    }

    const total = documentUris.length;
    let success = 0;


    for (const uri of documentUris) {
        try {
            // Get the content of the document
            const rawContent = fs.readFileSync(uri.fsPath);
            const content = iconv.decode(rawContent, selectedSrcEncoding);
            const encodedContent = iconv.encode(content, selectedDstEncoding);
            // Save the converted content back to the document
            await vscode.workspace.fs.writeFile(uri, encodedContent);
            success++;
            //await reopenDocumentWithEncoding(document, selectedEncoding);
        } catch (error) {
            console.error(`转换 ${uri.fsPath} 时失败: ${error}`);
        }
    }

    vscode.window.showInformationMessage(`转换${selectedSrcEncoding}至${selectedDstEncoding}: 共${total}个文件，成功转换${success}个文件`);
}
