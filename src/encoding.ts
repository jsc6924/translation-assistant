import * as vscode from 'vscode';
import * as fs from "fs";
import * as iconv from "iconv-lite";
import { selectBatchRange } from './batch';
const languageEncoding = require("detect-file-encoding-and-language");

const srcEncodings = ['utf8', 'utf16le', 'utf16be', 'shift-jis', 'gb2312', 'gbk'];
const dstEncodings = ['utf8', 'utf8-bom', 'utf16le', 'utf16le-bom', 'utf16be', 'utf16be-bom', 'shift-jis', 'gb2312', 'gbk'];
const bomMap: {  [key: string]: any } = {
    'utf16le-bom': [0xFF, 0xFE],
    'utf16be-bom': [0xFE, 0xFF],
    'utf8-bom':    [0xEF, 0xBB, 0xBF]
}

export function encodeWithBom(content: string, encoding: string): Buffer {
    if (encoding.endsWith('-bom')) {
        const bom = bomMap[encoding];
        if (!bom) {
            throw new Error("unknown encoding :" + encoding);
        }
        encoding = encoding.replace(/-bom/, '');
        const bomBuffer = Buffer.from(bom)
        return Buffer.concat([bomBuffer, iconv.encode(content, encoding)]);
    }
    return iconv.encode(content, encoding);
}

export async function batchConvertFilesEncoding() {
    
   const documentUris = await selectBatchRange(false);
    if (!documentUris) {
        return;
    }
    // Show encoding selection menu
    const selectedSrcEncoding = await vscode.window.showQuickPick(srcEncodings, {
        placeHolder: '选择文件原来的编码格式（如果有BOM将自动识别）',
    });

    if (!selectedSrcEncoding) {
        return; // User canceled the selection
    }

    // Show encoding selection menu
    const selectedDstEncoding = await vscode.window.showQuickPick(dstEncodings, {
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
            let encodedContent = encodeWithBom(content, selectedDstEncoding);
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

export async function detectFileEncoding(fsPath: string): Promise<string>  {
    const rawContent = fs.readFileSync(fsPath);
    return detectEncoding(rawContent);
}

export async function detectEncoding(content: Buffer): Promise<string> {
    const res = await languageEncoding(content);
    console.log(res);
    return res.encoding;
}