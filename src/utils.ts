import * as vscode from "vscode";
import * as fs from 'fs';
import * as path from 'path';
const decompress = require("decompress");
import { HttpClient } from "typed-rest-client/HttpClient";
const archiver = require("archiver");

export function findLastMatchIndex(pattern: RegExp, text: string): number {
  if (pattern.flags.indexOf('g') == -1) {
    vscode.window.showErrorMessage('pattern must have a "g" flag in findLastMatchIndex');
    return -1;
  }
  let match: RegExpExecArray | null;
  let lastMatch: RegExpExecArray | null = null;
  let cur = text;
  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length == 0) {
      pattern.lastIndex++;
    }
    lastMatch = match;
  }
  if (lastMatch) {
    return lastMatch.index;
  } else {
    return -1;
  }
}

export function countCharBeforeNewline(text: string, startIdx: number): number {
  let m = 0;
  for (let i = startIdx - 1; i >= 0; i--) {
    if (text[i] === '\n') {
      break;
    } else {
      m++;
    }
  }
  return m;
};

export function countLineUntil(text: string, startIdx: number): number {
  let n: number = 1;
  for (let i = 0; i < startIdx; i++) {
    if (text[i] == '\n')
      n++;
  }
  return n;
}

export function countLineFrom(text: string, startIdx: number): number {
  let n: number = 1;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '\n')
      n++;
  }
  return n;
}

export function setCursorAndScroll(editor: vscode.TextEditor, dn: number, m: number, scroll: boolean = true) {
  const position = editor.selection.active;
  const targetLine = position.line + dn;
  const newPosition = position.with(targetLine, m);
  editor.selection = new vscode.Selection(newPosition, newPosition);
  if (scroll) {
    const curRange = editor.visibleRanges[0];
    const halfHeight = Math.floor((curRange.end.line - curRange.start.line)) / 2;
    const pStart = curRange.start.with(Math.max(0, targetLine - halfHeight));
    const pEnd = curRange.start.with(Math.max(0, targetLine + halfHeight));
    editor.revealRange(curRange.with(pStart, pEnd));
  }
};

export function countStartingUnimportantChar(txt: string, start: number, wordSet: Set<string>): number {
  let n = 0;
  for (let i = start; i < txt.length; i++) {
    if (wordSet.has(txt[i]))
      n++;
    else
      break;
  }
  return n;
};

export function toDBC(txtstring: string) {
  var tmp = "";
  for (var i = 0; i < txtstring.length; i++) {
    if (txtstring.charCodeAt(i) == 32) {
      tmp = tmp + String.fromCharCode(12288);
    }
    if (txtstring.charCodeAt(i) < 127) {
      tmp = tmp + String.fromCharCode(txtstring.charCodeAt(i) + 65248);
    }
  }
  return tmp;
}

export function contains(str: string, search: string) {
  return str.indexOf(search) >= 0;
}


let diagnosticCollection: Map<string, vscode.DiagnosticCollection> = new Map<string, vscode.DiagnosticCollection>();

export function getOrCreateDiagnosticCollection(file: string) : vscode.DiagnosticCollection | undefined {
    if (!diagnosticCollection.has(file)) {
        diagnosticCollection.set(file, vscode.languages.createDiagnosticCollection(`dltxt-${file}`));
    }
    return diagnosticCollection.get(file);
}


type ContextValue = boolean | string;

/**
 * Wrapper around VS Code's `setContext`.
 * The API call takes several milliseconds to seconds to complete,
 * so let's cache the values and only call the API when necessary.
 */
export abstract class VSCodeContext {
  private static readonly cache: Map<string, ContextValue> = new Map();

  public static async set(key: string, value: ContextValue): Promise<void> {
    const prev = this.get(key);
    if (prev !== value) {
      this.cache.set(key, value);
      await vscode.commands.executeCommand('setContext', key, value);
    }
  }

  public static get(key: string): ContextValue | undefined {
    return this.cache.get(key);
  }
}

export function getCurrentWorkspaceFolder(): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    // Assuming you want to get the first workspace folder
    return workspaceFolders[0].uri.fsPath;
  }
  
  return undefined;
}

export function findEditorByUri(uri: vscode.Uri): vscode.TextEditor | undefined {
  const editors = vscode.window.visibleTextEditors;
  for (const editor of editors) {
    if (editor.document.uri.toString() === uri.toString()) {
      return editor;
    }
  }
  return undefined;
}


export function registerCommand(
	context: vscode.ExtensionContext,
	command: string,
	callback: (...args: any[]) => any,
	requiresActiveEditor: boolean = false
) {
	const disposable = vscode.commands.registerCommand(command, async (...args: any[]) => {
		if (requiresActiveEditor && !vscode.window.activeTextEditor) {
			return;
		}

		callback(...args);
	});
	context.subscriptions.push(disposable);
}


export function mapToObject<K, V>(map: Map<K, V>) : any {
  const plainObject: any = {};
  map.forEach((value, key) => {
    plainObject[key] = value;
  });
  return plainObject;
}


export function showOutputText(title:string, output: string) {
  // Create a new webview panel
  const panel = vscode.window.createWebviewPanel(
    'outputPanel',
    title,
    vscode.ViewColumn.Active,
    {
      enableScripts: false, // Disable JavaScript execution
      retainContextWhenHidden: true, // Retain webview content when panel is hidden
    }
  );

  // Set the HTML content of the webview
  panel.webview.html = output;
  panel.reveal();
  return panel;
}


export async function downloadFile(url: string, filePath: string): Promise<string> {
  const client = new HttpClient("clientTest");
  const response = await client.get(url);
  const file: NodeJS.WritableStream = fs.createWriteStream(filePath);
  
  if (response.message.statusCode !== 200) {
      const err: Error = new Error(`Unexpected HTTP response: ${response.message.statusCode}`);
      throw err;
  }
  return new Promise((resolve, reject) => {
      file.on("error", (err) => reject(err));
      const stream = response.message.pipe(file);
      stream.on("close", () => {
          try { resolve(filePath); } catch (err) {
              reject(err);
          }
      });
  });
}
export function unzipFile(zipFilePath: string, destinationPath: string) {
  return decompress(zipFilePath, destinationPath)
}

export function compressFoldersToZip(sourceFolderPaths: string[], targetZipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(targetZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolve();
    });

    archive.on('error', (err: any) => {
      reject(err);
    });

    archive.pipe(output);

    sourceFolderPaths.forEach((folderPath) => {
      const folderName = path.basename(folderPath);
      archive.directory(folderPath, folderName);
    });

    archive.finalize();
  });
}

export function writeAtomic(filePath: string, data: string): void {
  const tempFilePath = `${filePath}.tmp`;
  
  try {
    fs.writeFileSync(tempFilePath, data);
    // Replace existing file with the temporary file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath); // Remove the existing file
    }
    fs.renameSync(tempFilePath, filePath);
  } catch (error) {
    console.error('Error writing file atomically:', error);
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath); // Clean up the temporary file in case of error
    }
  }
}


export class ContextHolder {
  private static context: vscode.ExtensionContext | undefined;
  static set(context: vscode.ExtensionContext) {
    ContextHolder.context = context;
  }
  static get() {
    if (!ContextHolder.context) {
      throw new Error('context is not initialized');
    }
    return ContextHolder.context;
  }
  static getGlobalState(): IterableMomento {
    return this.get().globalState as IterableMomento;
  }
  static getWorkspaceState(): IterableMomento {
    return this.get().workspaceState as IterableMomento;
  }
}


interface IterableMomento extends vscode.Memento {
  keys(): string[];
}

export class DictSettings {
  static getAllDictNames() {
    let v = ContextHolder.getGlobalState().get(`dltxt.dict.list`) as Array<string>;
    if (v === undefined) {
      v = [];
    }
    return v;
  }
  static setAllDictNames(names: string[]) {
    return ContextHolder.getGlobalState().update(`dltxt.dict.list`, names);
  }
  static getDictType(name: string) : string | undefined {
    return ContextHolder.getGlobalState().get(`dltxt.dict.${name}.type`) as string;
  }
  static setDictType(name: string, value: string | undefined) {
    return ContextHolder.getGlobalState().update(`dltxt.dict.${name}.type`, value);
  }
  static getGameTitle(name: string)  : string | undefined {
      return ContextHolder.getWorkspaceState().get(`dltxt.dict.${name}.gameTitle`) as string;
  }
  static setGameTitle(name: string, value: string | undefined) {
      return ContextHolder.getWorkspaceState().update(`dltxt.dict.${name}.gameTitle`, value);
  }
  static getSimpleTMApiToken(name: string) : string | undefined {
      return ContextHolder.getGlobalState().get(`dltxt.dict.${name}.api`) as string;
  }
  static setSimpleTMApiToken(name: string, value: string | undefined) {
      return ContextHolder.getGlobalState().update(`dltxt.dict.${name}.api`, value);
  }
  static getSimpleTMUrl(name: string) : string | undefined{
      return ContextHolder.getGlobalState().get(`dltxt.dict.${name}.url`) as string;
  }
  static setSimpleTMUrl(name: string, value: string | undefined) {
      return ContextHolder.getGlobalState().update(`dltxt.dict.${name}.url`, value);
  }
  static getSimpleTMUsername(name: string)  : string | undefined {
      return ContextHolder.getGlobalState().get(`dltxt.dict.${name}.username`) as string;
  }
  static setSimpleTMUsername(name: string, value: string | undefined) {
      return ContextHolder.getGlobalState().update(`dltxt.dict.${name}.username`, value);
  }
  static getSimpleTMDictKeys(name: string, game: string | undefined) {
    const v = ContextHolder.getWorkspaceState().get(`dltxt.dict.${name}.dictkey.${game}`) as Array<any>;
    if (!v) {
      return [];
    }
    return v;
  }
  static setSimpleTMDictKeys(name: string, game: string, value: any) {
      return ContextHolder.getWorkspaceState().update(`dltxt.dict.${name}.dictkey.${game}`, value);
  }
  static removeDict(name: string) {
    let names = DictSettings.getAllDictNames();
    const i = names.indexOf(name);
    if (i != -1) {
      names.splice(i, 1)
      DictSettings.setAllDictNames(names);
    }

    ContextHolder.getGlobalState().keys()
      .filter(k => k.startsWith(`dltxt.dict.${name}`))
      .map(k => ContextHolder.getGlobalState().update(k, undefined));

    ContextHolder.getWorkspaceState().keys()
      .filter(k => k.startsWith(`dltxt.dict.${name}`))
      .map(k => ContextHolder.getWorkspaceState().update(k, undefined));
  }
  
}
