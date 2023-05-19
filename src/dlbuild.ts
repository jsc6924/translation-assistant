import * as fs from 'fs';
import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as iconv from "iconv-lite";


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

export function extract(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return;
    }
    const rootDir = folders[0].uri.fsPath;
    const yamlPath = path.join(rootDir, RelativeYAMLPath);

    if (!fs.existsSync(yamlPath)) {
        vscode.window.showErrorMessage('当前目录下未找到dlbuild.yaml');
        return;
    }
    const yamlData = readYamlFile(yamlPath);
    const inputPath = path.join(rootDir, yamlData.extract.input.path);
    const outPath = path.join(rootDir, yamlData.extract.output.path);
    const labelledPath = path.join(rootDir, RelativeLabelledPath);

    fs.mkdirSync(outPath, { recursive: true });
    fs.mkdirSync(labelledPath, { recursive: true });

    const files = fs.readdirSync(inputPath);
    const ext = yamlData.extract.input.ext;

    for (const file of files) {
        if (path.extname(file) !== ext) {
            continue;
        }
        const filePath = path.join(inputPath, file);
        const item = vscode.Uri.file(filePath);
        processExtract(yamlData, item, outPath, labelledPath);
    }
    vscode.window.showInformationMessage(`提取完成`);
}

function testReplace() {
    let str = '@Talk name=叶 @Talk name=叶';
    const regex = /@Talk .*?name=(\S+)/g;
    const groupNumber = 1; // Variable representing the group number
    const replacement = '[[label]]'

    let match;
    while (match = regex.exec(str)) {
        if (match[groupNumber]) {
            console.log(match)
            const startIndex = match.index + match[0].indexOf(match[groupNumber]);
            const endIndex = startIndex + match[groupNumber].length;
            str = str.slice(0, startIndex) + replacement + str.slice(endIndex);
            regex.lastIndex = regex.lastIndex - match[groupNumber].length + replacement.length;
        }
    }
    return match;
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


function processExtract(yamlData: any, item: vscode.Uri, outPath: string, labelledPath: string): void {

    const stem = getStemFromUri(item);
    if (!stem) {
        return;
    }

    const srcEncoding: string = yamlData.extract.input.encoding;
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
                    const replacement = `[[${tag}]]`;
                    lline = lline.slice(0, startIndex) + replacement + lline.slice(endIndex);

                    pattern.lastIndex = pattern.lastIndex - match[groupId].length + replacement.length;
                    if (pattern.lastIndex <= prevPatternLastIndex) {
                        pattern.lastIndex = prevPatternLastIndex + 1;
                    }
                    prevPatternLastIndex = pattern.lastIndex;
                    i += 1;
                }
            }
        }
        fLabelStr += addNewLine(lline);
    });
    const encodedOutBuffer = iconv.encode(fOutStr, dstEncoding);
    fs.writeFileSync(fOut, encodedOutBuffer);
    const encodedLabelledBuffer = iconv.encode(fLabelStr, dstEncoding);
    fs.writeFileSync(fLabel, encodedLabelledBuffer);

}

export function pack(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found.');
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

    for (const file of files) {
        if (path.extname(file) !== '.txt') {
            continue;
        }
        const filePath = path.join(transPath, file);
        const item = vscode.Uri.file(filePath);
        processPack(yamlData, item, labelledPath, replacedPath);
    }
    vscode.window.showInformationMessage(`替换完成`);
}

function processPack(yamlData: any, item: vscode.Uri, labeledPath: string, replacedPath: string): void {
    const stem = getStemFromUri(item);
    if (!stem) {
        console.error('Invalid filename:', item.fsPath);
        return;
    }
    const ext = yamlData.extract.input.ext;
    const labeledItem = path.join(labeledPath, `${stem}.label`);
    const replacedItem = path.join(replacedPath, `${stem}.${ext}`);

    const srcEncoding: string = yamlData.pack.input.encoding;
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

    const patternTag = /\[\[([a-z]*\d+)\]\]/
    const patternKeyValue = /☆([a-z]*\d+)☆(.*)/;

    try {
        while (i < lbLines.length && j < trLines.length) {
            const m = patternTag.exec(lbLines[i]);

            if (m) {
                const [fullTag, tag] = m;

                while (j < trLines.length) {
                    if (trLines[j].trim().startsWith('☆') && trLines[j].includes(tag)) {
                        break;
                    }
                    j++;
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
        console.error(e);
        console.error(`item=${item.fsPath}`);
        console.error(`i=${i}, j=${j}`);
    }

    const encodedLabelledBuffer = iconv.encode(fReplacedStr, dstEncoding);
    fs.writeFileSync(fReplaced, encodedLabelledBuffer);
}
