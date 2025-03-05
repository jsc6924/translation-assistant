import * as vscode from "vscode";
import * as fs from 'fs';
import * as path from 'path';
const decompress = require("decompress");
import { HttpClient } from "typed-rest-client/HttpClient";
const archiver = require("archiver");

export type Pair<T1, T2> = [T1, T2];

export function findLastMatchIndex(pattern: RegExp, text: string): number {
  if (pattern.flags.indexOf('g') == -1) {
    vscode.window.showErrorMessage('pattern must have a "g" flag in findLastMatchIndex');
    return -1;
  }
  let match: RegExpExecArray | null;
  let lastMatch: RegExpExecArray | null = null;
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

export function findAllAndProcess(pattern: RegExp, text: string, 
  cb: (match: RegExpExecArray) => boolean) {
  if (pattern.flags.indexOf('g') == -1) {
    vscode.window.showErrorMessage('pattern must have a "g" flag');
    return -1;
  }
  let match: RegExpExecArray | null;
  let p = undefined;
  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length == 0) { //if matched empty string
      pattern.lastIndex++;
    } else {
      if (cb(match)) {
        return;
      }
    }
  }
}

export function setCursorAndScroll(editor: vscode.TextEditor, dn: number, m: number, scroll: boolean = true) {
  const position = editor.selection.active;
  const targetLine = position.line + dn;
  const newPosition = position.with(targetLine, m);
  editor.selection = new vscode.Selection(newPosition, newPosition);
  if (scroll) {
    editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenter);
  }
};

export function repeatN(s: string, k: number): string {
  let res = '';
  while(k > 0) {
    res += s;
    k--;
  }
  return res;
}

export function repeatStr(s: string, k: number, addSuffix: boolean): string {
  if (addSuffix && k >= 3) {
    let res = '';
    res = repeatN(s, k*2/3);
    res += repeatN('～', k/3);
    return res;
  } else {
    return repeatN(s, k);
  }
}

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

export function toAscii(txtstring: string) {
  var tmp = "";
  for (var i = 0; i < txtstring.length; i++) {
    if (txtstring.charCodeAt(i) == 12288) {
      tmp = tmp + String.fromCharCode(32);
    }
    if (txtstring.charCodeAt(i) >= 65248 && txtstring.charCodeAt(i) < 65248 + 127) {
      tmp = tmp + String.fromCharCode(txtstring.charCodeAt(i) - 65248);
    }
  }
  return tmp;
}

export function katakanaToHiragana(input: string): string {
  return input.replace(/[\u30a1-\u30f6]/g, function(match) {
      return String.fromCharCode(match.charCodeAt(0) - 0x60);
  });
}

export function contains(str: string, search: string) {
  return str.indexOf(search) >= 0;
}

export function isAscii(char: string) {
  const charCode = char.charCodeAt(0);
  return charCode <= 127;
}

export const DltxtDiagCollection = vscode.languages.createDiagnosticCollection(`dltxt`);
export const DltxtDiagCollectionSpellcheck = vscode.languages.createDiagnosticCollection(`dltxt-spellcheck`);
export const DltxtDiagCollectionMissionLine = vscode.languages.createDiagnosticCollection(`dltxt-missingline`);

type ContextValue = boolean | string;

/**
 * Wrapper around VS Code's `setContext`.
 * 
 * The value setted by setContext can be used in when clause in package.json
 * 
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
    try {
      await callback(...args);
    } catch(e) {
      vscode.window.showErrorMessage(`${e}`);
    }
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

export function isAsciiOnly(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 127) {
      return false;
    }
  }
  return true;
}

export function escapeHtml(text: string): string {
  const map = new Map<string, string>([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#039;']
]);
  return text.replace(/[&<>"']/g, function(m: string) { return map.get(m) as string; });
}

export function isFunctionalCharsOnly(text: string): boolean {
  return /^[…。，、！？「」『』【】（）～~♪]+$/.test(text);
}

export function shouldSkipChecking(text: string, delims: RegExp) {
  if (isAsciiOnly(text) || isFunctionalCharsOnly(text)) {
      return true;
  }

  const hasQuestionMark = /？？？/.test(text);
  if (hasQuestionMark) { // is name
      return true;
  }
  delims.lastIndex = 0;
  const hasDelims = delims.test(text);
  return !hasDelims; //is name
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

export function getWebviewContent(scritpUri: vscode.Uri, cssUri: vscode.Uri, jsonString: string): string {
  return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link rel="stylesheet" type="text/css" href="${cssUri}">
      </head>
      <body>
          <script src="${scritpUri}"></script>
          <div id="view-root"></div>
          <pre id='raw-data' hidden>${jsonString}</pre> 
      </body>
      </html>`;
}


export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

export function regEscape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

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

export function compareVersions(version1: string, version2: string) {
  const [major1, minor1, patch1] = version1.split('.').map(Number);
  const [major2, minor2, patch2] = version2.split('.').map(Number);

  if (major1 !== major2) {
      return major1 - major2;
  }
  if (minor1 !== minor2) {
      return minor1 - minor2;
  }
  return patch1 - patch2;
}

/*
* Wrapper of globalState and workspaceState of vscode.ExtensionContext
*/
export class ContextHolder {
  private static context: vscode.ExtensionContext | undefined;
  private static workspaceCache: Map<string, any> = new Map();
  static get(): vscode.ExtensionContext {
    if (!ContextHolder.context) {
      throw new Error("context is not initialized");
    }
    return ContextHolder.context;
  }
  static set(context: vscode.ExtensionContext) {
    ContextHolder.context = context;
    for(const k of context.workspaceState.keys()) {
      ContextHolder.workspaceCache.set(k, context.workspaceState.get(k));
    }
  }
  static getGlobalState(key: string, defaultValue?: any): any {
    const v = ContextHolder.context?.globalState.get(key);
    if(defaultValue !== undefined && v === undefined) {
      return defaultValue;
    }
    return v;
  }
  static getWorkspaceState(key: string, defaultValue?: any): any {
    const v = ContextHolder.workspaceCache.get(key);
    if(defaultValue !== undefined && v === undefined) {
      return defaultValue;
    }
    return v;
  }
  static setGlobalState(key: string, value: any) {
    ContextHolder.context?.globalState.update(key, value);
  }
  static setWorkspaceState(key: string, value: any) {
    if (value === undefined) {
      ContextHolder.workspaceCache.delete(key);
    } else {
      ContextHolder.workspaceCache.set(key, value);
    }
    ContextHolder.context?.workspaceState.update(key, value);
  }
  static setGlobalTempState(key: string, value: any, durationSecond: number) {
    const currentTimestampInSeconds = Math.floor(Date.now() / 1000);
    const obj = {expire: currentTimestampInSeconds + durationSecond, value};
    console.log("now = ", currentTimestampInSeconds);
    console.log("set", obj);
    ContextHolder.setGlobalState(`_tmp.${key}`, obj);
  }
  static getGlobalTempState(key: string) {
    const currentTimestampInSeconds = Math.floor(Date.now() / 1000);
    const obj = ContextHolder.getGlobalState(`_tmp.${key}`);
    console.log("now = ", currentTimestampInSeconds);
    console.log("get", obj);
    if (obj?.expire && obj.expire >= currentTimestampInSeconds) {
      return obj.value;
    }
    ContextHolder.setGlobalState(`_tmp.${key}`, undefined);
    return undefined;
  }
  static getGlobalStateKeys() {
    return ContextHolder.context?.globalState.keys() ?? [];
  }
  static getWorkspaceStateKeys() {
    return ContextHolder.context?.workspaceState.keys() ?? [];
  }
}

export class DictType {
  static RemoteUser = 'remote';
  static RemoteURL = 'remote-url';
  static Local = 'local';
}

/*
* A further wrapper on ContextHolder for dictionary related settings, 
* as there are too many of them and error-prone.
*/
export class DictSettings {
  static getAllDictNames() {
    let v = ContextHolder.getGlobalState(`dltxt.dict.list`) as Array<string>;
    if (v === undefined) {
      v = [];
    }
    return v;
  }
  static setAllDictNames(names: string[]) {
    return ContextHolder.setGlobalState(`dltxt.dict.list`, names);
  }
  static getDictType(name: string) : string | undefined {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.type`) as string;
  }
  static setDictType(name: string, value: string | undefined) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.type`, value);
  }

  //----------------style settings-------------------//
  static getStyleShow(name: string): boolean {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.show`) as string === 'true';
  }
  static setStyleShow(name: string, value: 'true' | 'false') {
    return  ContextHolder.setGlobalState(`dltxt.dict.${name}.style.show`, value);
  }

  static getStyleOverviewColor(name: string) {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.overviewColor`);
  }
  static setStyleOverviewColor(name: string, value: string) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.style.overviewColor`, value);
  }

  static getStyleOverviewPosition(name: string) {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.overviewPosition`);
  }
  static setStyleOverviewPosition(name: string, value: string) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.style.overviewPosition`, value);
  }

  static getStyleBorderWidth(name: string) {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.BorderWidth`);
  }
  static setStyleBorderWidth(name: string, value: string) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.style.BorderWidth`, value);
  }

  static getStyleBorderStyle(name: string) {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.BorderStyle`);
  }
  static setStyleBorderStyle(name: string, value: string) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.style.BorderStyle`, value);
  }

  static getStyleBorderRadius(name: string) {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.BorderRadius`);
  }
  static setStyleBorderRadius(name: string, value: string) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.style.BorderRadius`, value);
  }

  static getStyleLightBackgroundColor(name: string) {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.light.backgroundColor`);
  }
  static setStyleLightBackgroundColor(name: string, value: string) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.style.light.backgroundColor`, value);
  }
  static getStyleDarkBackgroundColor(name: string) {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.dark.backgroundColor`);
  }
  static setStyleDarkBackgroundColor(name: string, value: string) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.style.dark.backgroundColor`, value);
  }

  static getStyleLightBorderColor(name: string) {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.light.borderColor`);
  }  
  static setStyleLightBorderColor(name: string, value: string) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.style.light.borderColor`, value);
  }
  static getStyleDarkBorderColor(name: string) {
    return ContextHolder.getGlobalState(`dltxt.dict.${name}.style.dark.borderColor`);
  }  
  static setStyleDarkBorderColor(name: string, value: string) {
    return ContextHolder.setGlobalState(`dltxt.dict.${name}.style.dark.borderColor`, value);
  }

  static decoRepo = new Map<string, {version: string, deco: vscode.TextEditorDecorationType}>();

  static getDictDecoration(dictName: string): {deco: vscode.TextEditorDecorationType, oldDeco: vscode.TextEditorDecorationType | undefined, changed: boolean} {
    const overviewPosition = DictSettings.getStyleOverviewPosition(dictName);
    const overviewColor = DictSettings.getStyleOverviewColor(dictName);
    const borderWidth = DictSettings.getStyleBorderWidth(dictName);
    const borderStyle = DictSettings.getStyleBorderStyle(dictName);
    const borderRadius = DictSettings.getStyleBorderRadius(dictName);
    const lightBorderColor = DictSettings.getStyleLightBorderColor(dictName);
    const lightBackgroundColor = DictSettings.getStyleLightBackgroundColor(dictName);
    const darkBorderColor = DictSettings.getStyleDarkBorderColor(dictName);
    const darkBackgroundColor = DictSettings.getStyleDarkBackgroundColor(dictName);

    const decoVersion = `${overviewPosition}|${overviewColor}|${borderWidth}|${borderStyle}|${borderRadius}|${lightBorderColor}|${lightBackgroundColor}|${darkBorderColor}|${darkBackgroundColor}`;

    let oldDeco: vscode.TextEditorDecorationType | undefined = undefined;
    if (DictSettings.decoRepo.has(dictName)) {
      const {version, deco} = DictSettings.decoRepo.get(dictName) as any;
      if (decoVersion === version) {
        return {deco, oldDeco, changed: false};
      }
      oldDeco = deco;
    }
  
    const overviewPositionMapping : any = {
      'none': 0,
      'left': vscode.OverviewRulerLane.Left,
      'center': vscode.OverviewRulerLane.Center,
      'right': vscode.OverviewRulerLane.Right,
      'full': vscode.OverviewRulerLane.Full
    }
    let overviewPositionEnum = overviewPositionMapping[overviewPosition];
    if (overviewPositionEnum === undefined) {
      overviewPositionEnum = 0;
    }
  
    let obj = {
      borderWidth: borderWidth,
      borderStyle: borderStyle,
      borderRadius: borderRadius,
      overviewRulerColor: overviewColor,
      overviewRulerLane: overviewPositionEnum,
      light: {
          // this color will be used in light color themes
          borderColor: lightBorderColor,
          backgroundColor: lightBackgroundColor
      },
      dark: {
          // this color will be used in dark color themes
          borderColor: darkBorderColor,
          backgroundColor: darkBackgroundColor
      }
    };
    
    const newDeco = vscode.window.createTextEditorDecorationType(obj);
    DictSettings.decoRepo.set(dictName, {version: decoVersion, deco: newDeco});
    return {deco: newDeco, oldDeco, changed: true}
  }

  static getNewlineDecorationType(token: string): {deco: vscode.TextEditorDecorationType, oldDeco: vscode.TextEditorDecorationType | undefined} {
    const key = `__dltxt_newline_decoration`;
    let oldDeco: vscode.TextEditorDecorationType | undefined = undefined;
    if (DictSettings.decoRepo.has(key)) {
      const {_, deco} = DictSettings.decoRepo.get(key) as any;
      oldDeco = deco;
    }
    const x = token.length;
    const spacing = x <= 3 ? 0 : -Math.fround(1.0 - 3 / x);
    const deco = vscode.window.createTextEditorDecorationType({
      letterSpacing: `${spacing}ch`,
      borderWidth: "1px",
      borderStyle: "solid",
      borderRadius: "5px",
      color: 'transparent',
      after: {
        contentText: "⏎", 
        color: "gray", 
        fontWeight: "bold",
        margin: "0 1.5ch 0 -2.3ch"
      }
    });
    DictSettings.decoRepo.set(key, {version: '', deco: deco});
    return {deco, oldDeco};
  }



  //--------------connection settings------------------//
  static getGameTitle(name: string)  : string | undefined {
      return ContextHolder.getWorkspaceState(`dltxt.dict.${name}.gameTitle`) as string;
  }
  static setGameTitle(name: string, value: string | undefined) {
      return ContextHolder.setWorkspaceState(`dltxt.dict.${name}.gameTitle`, value);
  }
  static getSimpleTMApiToken(name: string) : string | undefined {
      return ContextHolder.getGlobalState(`dltxt.dict.${name}.api`) as string;
  }
  static setSimpleTMApiToken(name: string, value: string | undefined) {
      return ContextHolder.setGlobalState(`dltxt.dict.${name}.api`, value);
  }
  static getSimpleTMUrl(name: string) : string | undefined{
      return ContextHolder.getGlobalState(`dltxt.dict.${name}.url`) as string;
  }
  static setSimpleTMUrl(name: string, value: string | undefined) {
      return ContextHolder.setGlobalState(`dltxt.dict.${name}.url`, value);
  }
  static getSimpleTMUsername(name: string)  : string | undefined {
      return ContextHolder.getGlobalState(`dltxt.dict.${name}.username`) as string;
  }
  static setSimpleTMUsername(name: string, value: string | undefined) {
      return ContextHolder.setGlobalState(`dltxt.dict.${name}.username`, value);
  }
  static getSimpleTMSharedURL(name: string) : string | undefined {
      return ContextHolder.getWorkspaceState(`dltxt.dict.${name}.shared_url`) as string;
  }
  static setSimpleTMSharedURL(name: string, value: string | undefined) {
      ContextHolder.setWorkspaceState(`dltxt.dict.${name}.shared_url`, value);
  }
  static getSimpleTMDictKeys(name: string, game: string) {
    const v = ContextHolder.getWorkspaceState(`dltxt.dict.${name}.dictkey.${game}`) as Array<any>;
    if (!v) {
      return [];
    }
    return v;
  }
  static setSimpleTMDictKeys(name: string, game: string, value: any) {
      return ContextHolder.setWorkspaceState(`dltxt.dict.${name}.dictkey.${game}`, value);
  }
  static getLocalDictKeys(name: string, ) {
    const v = ContextHolder.getWorkspaceState(`dltxt.dict.${name}.dictkey`) as Array<any>;
    if (!v) {
      return [];
    }
    return v;
  }
  static setLocalDictKeys(name: string, value: any) {
      return ContextHolder.setWorkspaceState(`dltxt.dict.${name}.dictkey`, value);
  }
  static getLocalDictPath(name: string) {
    return ContextHolder.getWorkspaceState(`dltxt.dict.${name}.localPath`) as string;
  }
  static setLocalDictPath(name: string, fsPath: string | undefined) {
    return ContextHolder.setWorkspaceState(`dltxt.dict.${name}.localPath`, fsPath)
  }
  static removeDict(name: string) {
    let names = DictSettings.getAllDictNames();
    const i = names.indexOf(name);
    if (i != -1) {
      names.splice(i, 1)
      DictSettings.setAllDictNames(names);
    }

    ContextHolder.getGlobalStateKeys()
      .filter(k => k.startsWith(`dltxt.dict.${name}`))
      .map(k => ContextHolder.setGlobalState(k, undefined));

    ContextHolder.getWorkspaceStateKeys()
      .filter(k => k.startsWith(`dltxt.dict.${name}`))
      .map(k => ContextHolder.setWorkspaceState(k, undefined));
  }

  static clearLocalDict(name: string) {
    ContextHolder.getWorkspaceStateKeys()
      .filter(k => k.startsWith(`dltxt.dict.${name}`))
      .map(k => ContextHolder.setWorkspaceState(k, undefined));
  }
  
}

export const CSSNamedColors = [
  "transparent",
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen"
];
