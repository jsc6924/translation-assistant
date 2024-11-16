import * as fs from 'fs';
import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as vm from 'vm';
import * as iconv from "iconv-lite";
import { encodeWithBom, detectEncoding, detectFileEncoding } from './encoding';
import { isAscii, regEscape, registerCommand } from './utils';


import * as userScriptAPI from './user-script-api';
import { DocumentParser, getRegex } from './parser';


export const channel = vscode.window.createOutputChannel("DLTXT");

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

const buildYamlFileName = 'dlbuild.yaml';
const relativeLabelledPath = '.dltxt/dlbuild-labelled/'
const transformYamlFileName = 'dltransform.yaml';

export function activate(context: vscode.ExtensionContext) {
    registerCommand(context, 'Extension.dltxt.dlbuild.extract', () => {
		extract(context);
	});

	registerCommand(context, 'Extension.dltxt.dlbuild.pack', () => {
		pack(context);
	});

	registerCommand(context, 'Extension.dltxt.dltransform.concat', () => {
		concat(context);
	});

    registerCommand(context, 'Extension.dltxt.dltransform.wordcount', () => {
		wordcount(context);
	});

    registerCommand(context, 'Extension.dltxt.dltransform.transform', () => {
		transform(context);
	});

}

async function checkYaml(rootDir: string, yamlPath: string, context: vscode.ExtensionContext) {
    const basename = path.basename(yamlPath);
    if (!fs.existsSync(yamlPath)) {
        const userSelect = await vscode.window.showQuickPick(['复制默认配置文件后继续', '复制配置文件后取消操作', '取消操作'], {
            placeHolder: `当前目录下没有找到${basename}，请选择一个选项继续`
        });
        if (userSelect == '取消操作') {
            return false;
        }
        // Get the path to the source file within your extension's package
        const sourceFilePath = path.join(context.extensionPath, `templates/${basename}`);
        const destinationFilePath = path.join(rootDir, basename);
        fs.copyFileSync(sourceFilePath, destinationFilePath);
        vscode.window.showInformationMessage(`已在当前目录下生成${basename}`);
        if (userSelect == '复制配置文件后取消操作') {
            return false;
        }
    }
    return true;
}

async function getInputEncoding(encoding: string, contentBuf: Buffer): Promise<string> {
    if (!encoding || encoding === 'auto') {
        encoding = (await detectEncoding(contentBuf)).toLowerCase()
    }
    encoding = encoding.replace(/-bom/, '');
    return encoding;
}

export async function readFolderRecursively(folderPath: string, 
    relativeDirsStack: string[],
    onFile: ((f: string, relativeDir: string)=>void) | undefined, 
    onFolder: ((folderName: string, fs: string[], relativeDir: string) => void) | undefined,
    excludePattern: RegExp | undefined = /\..*/,
){
    const basename = path.basename(folderPath);
    if (excludePattern && excludePattern.test(basename)) {
        return;
    }
    const files = fs.readdirSync(folderPath);

    relativeDirsStack.push(basename);

    if (onFolder) {
        await onFolder(basename, files, path.join(...relativeDirsStack.slice(1)));
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.join(folderPath, file);
      const fileStats = fs.statSync(filePath);
  
      if (fileStats.isDirectory()) {
        await readFolderRecursively(filePath, relativeDirsStack, onFile, onFolder); // Recursively read subfolders
      } else {
        if (onFile) {
            await onFile(file, path.join(...relativeDirsStack.slice(1)));
        }
      }
    }
    relativeDirsStack.pop();
}

async function extract(context: vscode.ExtensionContext) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('vscode没有打开目录');
        return;
    }
    const rootDir = folders[0].uri.fsPath;
    const yamlPath = path.join(rootDir, buildYamlFileName);

    const good = await checkYaml(rootDir, yamlPath, context);
    if (!good) {
        return;
    }
    const yamlData = readYamlFile(yamlPath);
    const inputPath = path.join(rootDir, yamlData.extract.input.path);
    const outPath = path.join(rootDir, yamlData.extract.output.path);
    const labelledPath = path.join(rootDir, relativeLabelledPath);

    fs.mkdirSync(outPath, { recursive: true });
    fs.mkdirSync(labelledPath, { recursive: true });

    
    let ext = yamlData.extract.input.ext;
    if (ext && ext[0] !== '.') {
        ext = '.' + ext;
    }

    let total = 0;
    let success = 0;
    await readFolderRecursively(inputPath, [], async (file, relativeDir) => {
        if (ext && path.extname(file) !== ext) {
            return;
        }
        total++;
        const filePath = path.join(inputPath, relativeDir, file);
        const item = vscode.Uri.file(filePath);
        const realOutPath = path.join(outPath, relativeDir);
        const realLabelledPath = path.join(labelledPath, relativeDir);
        fs.mkdirSync(realOutPath, {recursive: true});
        fs.mkdirSync(realLabelledPath, {recursive: true});
        try {
            if (await processExtract(yamlData, item, realOutPath, realLabelledPath)) {
                success++;
            }
        } catch (e) {
            channel.appendLine(`提取${file}时出错: ${e}`);
        }
    }, undefined);
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


async function processExtract(yamlData: any, item: vscode.Uri, outPath: string, labelledPath: string): Promise<boolean> {

    let stem = getStemFromUri(item);
    if (!stem) {
        return false;
    }
    if(!yamlData.extract.input.ext) {
        const { base } = path.parse(item.fsPath);
        stem = base;
    }

    const dstEncoding: string = yamlData.extract.output.encoding;

    const outItem = Uri.joinPath(Uri.file(outPath), `${stem}.txt`);
    const labelItem = Uri.joinPath(Uri.file(labelledPath), `${stem}.label`);

    const fIn = fs.openSync(item.fsPath, 'r');
    const fOut = fs.openSync(outItem.fsPath, 'w');
    const fLabel = fs.openSync(labelItem.fsPath, 'w');

    const fInBuffer = fs.readFileSync(fIn);
    const srcEncoding: string = await getInputEncoding(yamlData.extract.input.encoding, fInBuffer);
    const fileContent = iconv.decode(fInBuffer, srcEncoding);
    const inLines = fileContent.split('\n');

    let fOutStr = "";
    let fLabelStr = "";

    const digits: number = yamlData.extract.input.digits;
    let i = 0;

    inLines.forEach((line) => {
        let lline = line.toString().trimRight();
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

async function pack(context: vscode.ExtensionContext) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('vscode没有打开目录');
        return;
    }
    const rootDir = folders[0].uri.fsPath;
    const yamlPath = path.join(rootDir, buildYamlFileName);

    if (!fs.existsSync(yamlPath)) {
        vscode.window.showErrorMessage('当前目录下未找到dlbuild.yaml');
        return;
    }
    const yamlData = readYamlFile(yamlPath);
    const transPath = path.join(rootDir, yamlData.pack.input.path);
    const replacedPath = path.join(rootDir, yamlData.pack.output.path);
    const labelledPath = path.join(rootDir, relativeLabelledPath);

    fs.mkdirSync(replacedPath, { recursive: true });

    let total = 0;
    let success = 0;

    await readFolderRecursively(transPath, [], async (file, relativeDir) => {
        if (path.extname(file) !== '.txt') {
            return;
        }
        total++;
        const filePath = path.join(transPath, relativeDir, file);
        const realLabelledPath = path.join(labelledPath, relativeDir);
        const realReplacedPath = path.join(replacedPath, relativeDir);
        fs.mkdirSync(realReplacedPath, {recursive: true});
        const item = vscode.Uri.file(filePath);
        try{
            if(await processPack(yamlData, item, realLabelledPath, realReplacedPath)) {
                success++;
            }
        } 
        catch(e) {
            channel.appendLine(`替换${file}时出错: ${e}`);
        }
    }, undefined);

    vscode.window.showInformationMessage(`替换完成：共${total}个文件，成功${success}个文件`);
    if (success !== total) {
        channel.show(true);
    }
}

async function processPack(yamlData: any, item: vscode.Uri, labeledPath: string, replacedPath: string) {
    const stem = getStemFromUri(item)
    if (!stem) {
        channel.appendLine(`Invalid filename: ${item.fsPath}`);
        return false;
    }
    const ext = yamlData.extract.input.ext;
    const labeledItem = path.join(labeledPath, `${stem}.label`);
    const replacedItem = ext ? path.join(replacedPath, `${stem}.${ext}`) : path.join(replacedPath, stem);


    const dstEncoding: string = yamlData.pack.output.encoding;

    const fTransBuffer = fs.readFileSync(item.fsPath);
    const srcEncoding: string = await getInputEncoding(yamlData.pack.input.encoding, fTransBuffer);
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
                    lbLines[i] = lbLines[i].replace(fullTag, text)
                } else {
                    throw new Error('Invalid translation line: ' + trLines[j]);
                }
            } else {
                fReplacedStr += addNewLine(lbLines[i]);
                i++;
            }
        }
    } catch (e) {
        channel.appendLine(`item=${item.fsPath}`);
        channel.appendLine(`labeled_line_num=${i}, translated_line_num=${j}`);
        channel.appendLine(`${e}`);
        return false;
    }

    const encodedLabelledBuffer = encodeWithBom(fReplacedStr, dstEncoding);
    fs.writeFileSync(fReplaced, encodedLabelledBuffer);
    return true;
}

async function concat(context: vscode.ExtensionContext) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('vscode没有打开目录');
        return;
    }
    const rootDir = folders[0].uri.fsPath;
    const yamlPath = path.join(rootDir, transformYamlFileName);

    const good = await checkYaml(rootDir, yamlPath, context);
    if (!good) {
        return;
    }
    const yamlData = readYamlFile(yamlPath);
    const inputPath = path.join(rootDir, yamlData.concat.input.path);
    const outputPath = path.join(rootDir, yamlData.concat.output.path);
    let total = 0;
    let success = 0;
    let numFolders = 0;

    await readFolderRecursively(inputPath, [], undefined, async (folderName, files, relativeDir) => {
        const outputFilePath = path.join(outputPath, relativeDir,  folderName+'.txt');
        numFolders++;
        fs.mkdirSync(path.join(outputPath, relativeDir), {recursive: true});
        const outContents :string[] = [];
        for (const file of files) {
            const inputFilePath = path.join(inputPath, relativeDir, file);
            const fileStats = fs.statSync(inputFilePath);
            if (!fileStats.isFile()) {
                continue;
            }
            try{
                total++;
                if(await processConcat(yamlData, inputFilePath, outContents)) {
                    success++;
                }
            } 
            catch(e) {
                channel.appendLine(`连接${file}时出错: ${e}`);
            }
        }
        const concatedContent = outContents.join("\r\n");
        const encodedBuf = encodeWithBom(concatedContent, yamlData.concat.output.encoding);
        fs.writeFileSync(outputFilePath, encodedBuf);
    });

    vscode.window.showInformationMessage(`连接完成：共${total}个文件，成功${success}个文件，输出${numFolders}个文件`);
    if (success !== total) {
        channel.show(true);
    }
    
}

async function processConcat(yamlData: any, inputPath: string, outContents: string[]) {
    const contentBuf = fs.readFileSync(inputPath);
    const srcEncoding: string = await getInputEncoding(yamlData.concat.input.encoding, contentBuf);
    const content = iconv.decode(contentBuf, srcEncoding);
    outContents.push(content);
    return true;
}

async function wordcount(context: vscode.ExtensionContext) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('vscode没有打开目录');
        return;
    }
    const rootDir = folders[0].uri.fsPath;
    const yamlPath = path.join(rootDir, transformYamlFileName);

    const good = await checkYaml(rootDir, yamlPath, context);
    if (!good) {
        return;
    }
    const yamlData = readYamlFile(yamlPath);
    
    const inputPath = path.join(rootDir, yamlData.wordcount.input.path);
    let total = 0;
    let success = 0;
    let jcount = 0, ccount = 0;

    await readFolderRecursively(inputPath, [], async (file, relativeDir) => {
        total++;
        const inputFilePath = path.join(inputPath, relativeDir, file);
        const contentBuf = fs.readFileSync(inputFilePath);
        const srcEncoding = await getInputEncoding(yamlData.wordcount.input.encoding, contentBuf);
        const content = iconv.decode(contentBuf, srcEncoding);
        DocumentParser.processPairedLines(content, (jgrps, cgrps) => {
            jcount += jgrps.text.length;
            ccount += cgrps.text.length;
        })
    }, undefined);

    vscode.window.showInformationMessage(`字数统计：共${total}个文件, 原文${jcount}字，译文${ccount}字`);
}

async function transform(context: vscode.ExtensionContext) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('vscode没有打开目录');
        return;
    }
    const rootDir = folders[0].uri.fsPath;
    const yamlPath = path.join(rootDir, transformYamlFileName);

    const good = await checkYaml(rootDir, yamlPath, context);
    if (!good) {
        return;
    }
    const yamlData = readYamlFile(yamlPath);
    const funcNode = yamlData.transform;
    
    const inputPath = path.join(rootDir, funcNode.input.path);
    const hasOutput = !!funcNode.output?.path;
    const outputPath = hasOutput ? path.join(rootDir, funcNode.output.path) : '';
    const dstEncoding = funcNode.output?.encoding;
    const onGlobalBegin = funcNode['on-global-begin'];
    const onGlobalEnd = funcNode['on-global-end'];
    const onFileBegin = funcNode['on-file-begin'];
    const onFileEnd = funcNode['on-file-end'];
    const operations = funcNode.operations ?? [];
    
    let total = 0;
    let success = 0;

    try {
        let scriptContext: vm.Context = vm.createContext();
        scriptContext.api = userScriptAPI;
        scriptContext.vars = new Map<string, any>();
        let script = new vm.Script('');
        if (funcNode.script?.path) {
            const scriptPath = path.join(rootDir, funcNode.script.path);
            const content = fs.readFileSync(scriptPath, 'utf8');
            script = new vm.Script(content);
        }
        const e = new Executor(script, scriptContext, rootDir);
        if (onGlobalBegin) {
            e.execScript(onGlobalBegin, {});
        }

        await readFolderRecursively(inputPath, [], async (file, relativeDir) => {
            total++;
            const inputFilePath = path.join(inputPath, relativeDir, file);
            const contentBuf = fs.readFileSync(inputFilePath);
            const srcEncoding = await getInputEncoding(funcNode.input.encoding, contentBuf);
            const content = iconv.decode(contentBuf, srcEncoding);
            const lines = content.split('\n');
            e.updateFile(file, inputFilePath);
            
            let resultString = '';
            

            if (onFileBegin) {
                e.execScript(onFileBegin, {lines});
            }
    
            for (let i = 0; i < lines.length; i++) {
                lines[i] = lines[i].trim();
                lines[i] = e.execOperations(operations, {line: lines[i], lines, index: i});
                resultString += addNewLine(lines[i]);
            }

            if (onFileEnd) {
                e.execScript(onFileEnd, {lines});
            }

            if (hasOutput) {
                const outputFilePath = path.join(outputPath, relativeDir, file)
                fs.mkdirSync(path.join(outputPath, relativeDir), {recursive: true});
                const encodedLabelledBuffer = encodeWithBom(resultString, dstEncoding);
                fs.writeFileSync(outputFilePath, encodedLabelledBuffer);
            }
    
        }, undefined);

        if (onGlobalEnd) {
            e.execScript(onGlobalEnd, {});
        }
    } catch (error) {
        channel.appendLine(`${error}`);
        channel.show();
        throw error;
    }

    vscode.window.showInformationMessage(`批量处理：共${total}个文件`);
    
}

class Executor {
    jreg: RegExp | undefined;
    creg: RegExp | undefined;
    oreg: RegExp | undefined;
    lastMatch: any | undefined;
    shouldExec: boolean = true;

    varMap: Map<string, any> = new Map();
    scriptContext: vm.Context;

    currentFile: string = '';
    currentFilePath: string = '';
    rootDir: string = '';

    constructor(script: vm.Script, scriptContext: vm.Context, rootDir: string) {
        this.scriptContext = scriptContext;
        const [jreg, creg, oreg] = getRegex();
        this.jreg = jreg;
        this.creg = creg;
        this.oreg = oreg;
        this.varMap.set('@original', jreg);
        this.varMap.set('@translation', creg);
        this.varMap.set('@other', oreg);
        this.varMap.set('$', 'ex.lastMatch.groups');
        this.rootDir = rootDir;
        scriptContext.api.getMatchedGroups = () => this.lastMatch?.groups;

        scriptContext.api.getFileName = () => this.currentFile;
        scriptContext.api.getFilePath = () => this.currentFilePath;
        scriptContext.api.getRootDir = () => this.rootDir;
        script.runInContext(scriptContext);
    }
    public updateFile(file: string, filePath: string) {
        this.currentFile = file;
        this.currentFilePath = filePath;
    }
    public execScript(functionName: string, context: any) {
        this.scriptContext[functionName](context);
    }
    public execOperations(op: any, context: any): string {
        return this.execBlock(op, context);
    }
    execBlock(block: any[], context: any): string {
        for(const statement of block) {
            const res = this.execStatement(statement, context);
            if (res !== undefined) {
                context.line = res;
            }
        }
        return context.line;
    }
    execStatement(op: any, context: any): string | undefined {
        const [k, v] = this.getObjectKV(op);
        switch(k) {
        case 'script':
            return  this.shouldExec ? this.scriptContext[v](context) : undefined;
        case 'select': {
            this.shouldExec = true;
            const reg = v.startsWith('@') ? this.varMap.get(v) : new RegExp(v);
            this.lastMatch = reg.exec(context.line);
            if (!this.lastMatch) {
                this.shouldExec = false;
            }
            return;
        }
        case 'end-select': {
            this.shouldExec = true;
            return;
        }
        case 'exec':
            if (this.shouldExec) {
                this.eval(v);
                return;
            }
            return;
        case 'commit':
            if (!this.shouldExec) {
                return;
            }
            const g = this.lastMatch.groups;
            return `${g.prefix}${g.white}${g.text}${g.suffix}`;
        case 'filter':
            if (this.shouldExec) {
                this.shouldExec = this.eval(v);
            }
            return;
        default:
            throw new Error(`unknown operation: ${k}`)
        }
    }

    eval(exp: string) {
        for(const [k, v] of this.varMap) {
            exp = exp.replace(new RegExp(regEscape(k), 'g'), v);
        }
        const f = new Function('ex', 'api', `return ${exp}`);
        return f(this, userScriptAPI);
    }
    

    getObjectKV(x: any): [string, any] {
        for(const [k, v] of Object.entries(x)) {
            return [k as string, v];
        }
        throw new Error(`malformed ${x}`);
    }

}

