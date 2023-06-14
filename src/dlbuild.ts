import * as fs from 'fs';
import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as iconv from "iconv-lite";
import { encodeWithBom } from './encoding';

const channel = vscode.window.createOutputChannel("DLTXT");

// Read YAML from a file
function readYamlFile(filePath: string): any {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const data = yaml.load(fileContent);
    return data;
}

function getStemFromUri(uri: vscode.Uri): string {
    const { name } = path.parse(uri.fsPath)
    return name;
}

const RelativeYAMLPath = 'dlbuild.yaml';
const RelativeLabelledPath = '.dltxt/dlbuild-labelled/'

async function checkYaml(rootDir: string, yamlPath: string, context: vscode.ExtensionContext) {
    if (!fs.existsSync(yamlPath)) {
        const userSelect = await vscode.window.showQuickPick(['复制默认配置文件后继续', '复制配置文件后取消操作', '取消操作'], {
            placeHolder: '当前目录下没有找到dlbuild.yaml，请选择一个选项继续'
        });
        if (userSelect == '取消操作') {
            return false;
        }
        // Get the path to the source file within your extension's package
        const sourceFilePath = path.join(context.extensionPath, 'templates/dlbuild.yaml')
        const destinationFilePath = path.join(rootDir, 'dlbuild.yaml')
        fs.copyFileSync(sourceFilePath, destinationFilePath);
        vscode.window.showInformationMessage('已在当前目录下生成dlbuild.yaml');
        if (userSelect == '复制配置文件后取消操作') {
            return false;
        }
    }
    return true;
}

export async function extract(context: vscode.ExtensionContext) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('vscode没有打开目录');
        return;
    }
    const rootDir = folders[0].uri.fsPath;
    const yamlPath = path.join(rootDir, RelativeYAMLPath);

    const good = await checkYaml(rootDir, yamlPath, context);
    if (!good) {
        return;
    }
    const yamlData = readYamlFile(yamlPath);
    const inputPath = path.join(rootDir, yamlData.extract.input.path);
    const outPath = path.join(rootDir, yamlData.extract.output.path);
    const labelledPath = path.join(rootDir, RelativeLabelledPath);

    fs.mkdirSync(outPath, { recursive: true });
    fs.mkdirSync(labelledPath, { recursive: true });

    const files = fs.readdirSync(inputPath);
    let ext = yamlData.extract.input.ext;
    if (ext && ext[0] !== '.') {
        ext = '.' + ext;
    }

    let total = 0;
    let success = 0;
    for (const file of files) {
        if (ext && path.extname(file) !== ext) {
            continue;
        }
        total++;
        const filePath = path.join(inputPath, file);
        const item = vscode.Uri.file(filePath);
        try {
            if (processExtract(yamlData, item, outPath, labelledPath)) {
                success++;
            }
        } catch (e) {
            channel.appendLine(`提取${file}时出错: ${e}`);
        }
    }
    vscode.window.showInformationMessage(`提取完成：共${total}个文件，成功${success}个文件`);
    if (success !== total) {
        channel.show(true);
    }
}


function addNewLine(str: string) {
    if (str.length == 0 || str[str.length - 1] !== '\r') {
        return str + '\r\n';
    }
    return str + '\n'
}
function addNewLines(str: string, k: number) {
    for (let i = 0; i < k; i++) {
        str = addNewLine(str);
    }
    return str;
}


function processExtract(yamlData: any, item: vscode.Uri, outPath: string, labelledPath: string): boolean {

    let stem = getStemFromUri(item);
    if (!stem) {
        return false;
    }
    if(!yamlData.extract.input.ext) {
        const { base } = path.parse(item.fsPath);
        stem = base;
    }

    const srcEncoding: string = yamlData.extract.input.encoding.replace(/-bom/, '');
    const dstEncoding: string = yamlData.extract.output.encoding;

    const outItem = Uri.joinPath(Uri.file(outPath), `${stem}.txt`);
    const labelItem = Uri.joinPath(Uri.file(labelledPath), `${stem}.label`);

    const fIn = fs.openSync(item.fsPath, 'r');
    const fOut = fs.openSync(outItem.fsPath, 'w');
    const fLabel = fs.openSync(labelItem.fsPath, 'w');

    const fInBuffer = fs.readFileSync(fIn);
    const fileContent = iconv.decode(fInBuffer, srcEncoding);
    const inLines = fileContent.split('\n');

    let fOutStr = "";
    let fLabelStr = "";

    const digits: number = yamlData.extract.input.digits;
    let i = 0;

    inLines.forEach((line) => {
        let lline = line.toString();
        for (let j = 0; j < yamlData.extract.input.items.length; j++) {
            const pattern = new RegExp(yamlData.extract.input.items[j].capture, 'g');
            const tagPrefix = yamlData.extract.input.items[j].tag;
            const groupId: number = yamlData.extract.input.items[j].group;

            let match;
            let prevPatternLastIndex = 0;
            while (match = pattern.exec(lline)) {
                if (match[groupId]) {
                    const text = match[groupId];
                    const tag = `${tagPrefix}${i.toString().padStart(digits, '0')}`;
                    fOutStr += addNewLine(`★${tag}★${text}`);
                    fOutStr += addNewLines(`☆${tag}☆${text}`, 3);
                    const startIndex = match.index + match[0].indexOf(match[groupId]);
                    const endIndex = startIndex + match[groupId].length;
                    const replacement = `[#[${tag}]#]`;
                    lline = lline.slice(0, startIndex) + replacement + lline.slice(endIndex);

                    pattern.lastIndex = pattern.lastIndex - match[groupId].length + replacement.length;
                    if (pattern.lastIndex <= prevPatternLastIndex) {
                        pattern.lastIndex = prevPatternLastIndex + 1;
                    }
                    prevPatternLastIndex = pattern.lastIndex;
                    i += 1;
                } else {
                    break;
                }
            }
        }
        fLabelStr += addNewLine(lline);
    });
    
    const encodedOutBuffer = encodeWithBom(fOutStr, dstEncoding);
    fs.writeFileSync(fOut, encodedOutBuffer);
    const encodedLabelledBuffer = encodeWithBom(fLabelStr, dstEncoding);
    fs.writeFileSync(fLabel, encodedLabelledBuffer);
    return true;
}

export async function pack(context: vscode.ExtensionContext) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('vscode没有打开目录');
        return;
    }
    const rootDir = folders[0].uri.fsPath;
    const yamlPath = path.join(rootDir, RelativeYAMLPath);

    if (!fs.existsSync(yamlPath)) {
        vscode.window.showErrorMessage('当前目录下未找到dlbuild.yaml');
        return;
    }
    const yamlData = readYamlFile(yamlPath);
    const transPath = path.join(rootDir, yamlData.pack.input.path);
    const replacedPath = path.join(rootDir, yamlData.pack.output.path);
    const labelledPath = path.join(rootDir, RelativeLabelledPath);

    fs.mkdirSync(replacedPath, { recursive: true });

    const files = fs.readdirSync(transPath);

    let total = 0;
    let success = 0;

    for (const file of files) {
        if (path.extname(file) !== '.txt') {
            continue;
        }
        total++;
        const filePath = path.join(transPath, file);
        const item = vscode.Uri.file(filePath);
        try{
            if(processPack(yamlData, item, labelledPath, replacedPath)) {
                success++;
            }
        } 
        catch(e) {
            channel.appendLine(`替换${file}时出错: ${e}`);
        }
    }
    vscode.window.showInformationMessage(`替换完成：共${total}个文件，成功${success}个文件`);
    if (success !== total) {
        channel.show(true);
    }
}

function processPack(yamlData: any, item: vscode.Uri, labeledPath: string, replacedPath: string): boolean {
    const stem = getStemFromUri(item)
    if (!stem) {
        channel.appendLine(`Invalid filename: ${item.fsPath}`);
        return false;
    }
    const ext = yamlData.extract.input.ext;
    const labeledItem = path.join(labeledPath, `${stem}.label`);
    const replacedItem = ext ? path.join(replacedPath, `${stem}.${ext}`) : path.join(replacedPath, stem);

    const srcEncoding: string = yamlData.pack.input.encoding.replace(/-bom/, '');
    const dstEncoding: string = yamlData.pack.output.encoding;

    const fTransBuffer = fs.readFileSync(item.fsPath);
    const fTransContent = iconv.decode(fTransBuffer, srcEncoding);
    const fLabelBuffer = fs.readFileSync(labeledItem);
    const fLabelContent = iconv.decode(fLabelBuffer, srcEncoding);
    const fReplaced = fs.openSync(replacedItem, 'w');
    let fReplacedStr = "";

    const trLines = fTransContent.split('\n');
    const lbLines = fLabelContent.split('\n');

    let i = 0;
    let j = 0;

    const patternTag = /\[#\[([a-zA-Z]*\d+)\]#\]/
    const patternKeyValue = /☆([a-zA-Z]*\d+)☆(.*)/;

    try {
        while (i < lbLines.length && j < trLines.length) {
            const m = patternTag.exec(lbLines[i]);

            if (m) {
                const [fullTag, tag] = m;

                while (j < trLines.length) {
                    const decoratedTag = `☆${tag}☆`
                    if (trLines[j].trim().startsWith('☆') && trLines[j].includes(decoratedTag)) {
                        break;
                    }
                    j++;
                }
                if (j == trLines.length) {
                    throw new Error(`Unable to find tag: ${tag}`)
                }

                const mkv = patternKeyValue.exec(trLines[j]);

                if (mkv) {
                    const [_, matchedTag, text] = mkv;
                    if(tag !== matchedTag) {
                        throw new Error('label not matched');
                    }
                    fReplacedStr += addNewLine(lbLines[i].replace(fullTag, text));
                } else {
                    throw new Error('Invalid translation line: ' + trLines[j]);
                }
            } else {
                fReplacedStr += addNewLine(lbLines[i]);
            }

            i++;
        }
    } catch (e) {
        channel.appendLine(`item=${item.fsPath}`);
        channel.appendLine(`labeled_line_num=${i}, translated_line_num=${j}`);
        channel.appendLine(`${e}`);
        return false;
    }

    const encodedLabelledBuffer = encodeWithBom(fReplacedStr, dstEncoding);
    fs.writeFileSync(fReplaced, encodedLabelledBuffer);
    return true
}
