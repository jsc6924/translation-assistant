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
    const filter = yamlData.extract.input.filter;

    for (const file of files) {
        if (filter && path.extname(file) !== filter) {
            continue;
        }
        const filePath = path.join(inputPath, file);
        const item = vscode.Uri.file(filePath);
        processExtract(yamlData, item, outPath, labelledPath);
    }
    vscode.window.showInformationMessage(`转换完成`);
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

    let i = 0;

    inLines.forEach((line) => {
        let lline = line.toString();
        const sline = line.trim();
        for (let j = 0; j < yamlData.extract.input.items.length; j++) {
            const pattern = new RegExp(yamlData.extract.input.items[j].capture);
            const tagPrefix = yamlData.extract.input.items[j].tag;
            const groupId: number = yamlData.extract.input.items[j].group;
            const m = pattern.exec(sline);
            if (m) {
                const text = m[groupId].trim();
                const tag = `${tagPrefix}${i.toString().padStart(5, '0')}`;
                fOutStr += `★${tag}★${text}\n`;
                fOutStr += `☆${tag}☆${text}\n\n\n`;
                lline = line.replace(text, `[[${tag}]]`);
                i += 1;
                break;
            }
        }
        fLabelStr += lline + '\n';
    });
    const encodedOutBuffer = iconv.encode(fOutStr, dstEncoding);
    fs.writeFileSync(fOut, encodedOutBuffer);
    const encodedLabelledBuffer = iconv.encode(fLabelStr, dstEncoding);
    fs.writeFileSync(fLabel, encodedLabelledBuffer);

}
