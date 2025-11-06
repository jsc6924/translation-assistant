import * as vscode from 'vscode';
import { createErrorDiagnostic, createErrorDiagnosticMultiLine, createDiagnostic } from './error-check';
import * as utils from './utils';
import { AutoDetector, NoopAutoDetector, StandardParserAutoDetector, TextBlockAutoDetector } from './auto-format';
import { findAllAndProcess } from './utils';
import { get } from 'http';

export function getRegex() {
    const config = vscode.workspace.getConfiguration("dltxt.core");
    const jPreStr = config.get('originalTextPrefixRegex') as string;
    const cPreStr = config.get('translatedTextPrefixRegex') as string;
    const oPreStr = config.get('otherPrefixRegex') as string;
    const jWhiteStr = config.get('x.originalTextWhite') as string;
    const cWhiteStr = config.get('x.translatedTextWhite') as string;
    const jSuffixStr = config.get('y.originalTextSuffix') as string;
    const cSuffixStr = config.get('y.translatedTextSuffix') as string;
    if (!jPreStr || !cPreStr) {
      return [undefined, undefined, undefined];
    }
    try {
      const jreg = new RegExp(`^(?<prefix>${jPreStr})(?<white>${jWhiteStr})(?<text>.*?)(?<suffix>${jSuffixStr})$`);
      const creg = new RegExp(`^(?<prefix>${cPreStr})(?<white>${cWhiteStr})(?<text>.*?)(?<suffix>${cSuffixStr})$`);
      const oreg = oPreStr ? new RegExp(`^(?<prefix>${oPreStr})(?<text>.*?)$`) : undefined;
      return [jreg, creg, oreg];
    } catch (e) {
      vscode.window.showErrorMessage(`${e}`);
      return [undefined, undefined, undefined];
    }
}

function getTextBlockRegex() {
  const config = vscode.workspace.getConfiguration("dltxt.core");
  const regStr = config.get('textBlock.pattern') as string;
  const jPrefixStr = config.get('x.textBlock.originalPrefix') as string;
  const cPrefixStr = config.get('x.textBlock.translatedPrefix') as string;
  const jWhiteStr = config.get('x.originalTextWhite') as string;
  const cWhiteStr = config.get('x.translatedTextWhite') as string;
  const jSuffixStr = config.get('y.originalTextSuffix') as string;
  const cSuffixStr = config.get('y.translatedTextSuffix') as string;
  
  const reg = new RegExp(regStr, 'gm');
  const jreg = new RegExp(`^(?<prefix>${jPrefixStr})(?<white>${jWhiteStr})(?<text>.*?)(?<suffix>${jSuffixStr})$`);
  const creg = new RegExp(`^(?<prefix>${cPrefixStr})(?<white>${cWhiteStr})(?<text>.*?)(?<suffix>${cSuffixStr})$`);
  return [reg, jreg, creg];
}

export interface MatchedGroups {
    prefix: string;
    white: string;
    text: string;
    suffix: string;
}

////////////////////////Start standard parser///////////////////////////////

interface DocumentParser {
  processPairedLines(text: string | string[] | vscode.TextDocument, cb: (jgrps: MatchedGroups, cgrps: MatchedGroups, j_index: number, c_index: number, talkingName?: string) => void): void;

  processTranslatedLines(text: string | string[] | vscode.TextDocument, cb: (cgrps: MatchedGroups, c_index: number) => void): void;

  getCurrentTranslationLine(editor: vscode.TextEditor | undefined, lineNum?: number): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined];

  getNextTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined];

  getPrevTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined];

  errorCheck(document: string | string[] | vscode.TextDocument): [boolean, vscode.Diagnostic[]];

  getFormatDetector(): AutoDetector;
}

class StandardDocumentParser implements DocumentParser {
    constructor() {

    }

    processPairedLines(text: string | string[] | vscode.TextDocument, cb: (jgrps: MatchedGroups, cgrps: MatchedGroups, j_index: number, c_index: number, talkingName?: string) => void) {
        const [jreg, creg] = getRegex();
        if (!jreg || !creg) {
            throw new Error('jreg or creg undefined');
        }
        const namePosition = getTalkingNamePosition();
        const nameRegex = getTalkingNameRegex();
        const defaultTalkingName = getDefaultTalkingName();
        let beforeName = defaultTalkingName;

        let lines = getLines(text);
        let jgrps: MatchedGroups | undefined;
        let j_index = -1;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            line = line.trimRight();
            const m = jreg.exec(line);

            if (namePosition === NamePosition.Before && nameRegex) {
                const nameMatch = nameRegex.exec(line);
                if (nameMatch && nameMatch.groups) {
                    beforeName = nameMatch.groups.name || defaultTalkingName;
                }
            }

            if (m && m.groups) {
                if (!!jgrps) {
                    throw new Error(`Unmatched jgrps at line ${j_index}: ${jgrps.prefix}${jgrps.white}${jgrps.text}${jgrps.suffix}`);
                }
                jgrps = m.groups as any as MatchedGroups;
                j_index = i;
            } else {
                const m = creg.exec(line);
                if (m && m.groups && jgrps) {
                    const cgrps = m.groups as any as MatchedGroups;
                    adjust(jgrps, cgrps);
                    let talkingName = beforeName;
                    if (namePosition === NamePosition.Inline) {
                      talkingName = defaultTalkingName;
                        const inlineMatch = nameRegex?.exec(cgrps.text);
                        if (inlineMatch && inlineMatch.groups) {
                            talkingName = inlineMatch.groups.name || defaultTalkingName;
                        }
                    }
                    cb(jgrps, cgrps, j_index, i, talkingName);

                    if (namePosition === NamePosition.Before && jgrps?.suffix?.includes('」')) {
                        beforeName = defaultTalkingName;
                    }

                    jgrps = undefined;
                    j_index = -1;
                }
            }

        }
    }

    processTranslatedLines(text: string | string[] | vscode.TextDocument, cb: (cgrps: MatchedGroups, c_index: number) => void) {
      const [, creg] = getRegex();
      if (!creg) {
          throw new Error('jreg or creg undefined');
      }
      let lines = getLines(text);
      for (let i = 0; i < lines.length; i++) {
          let line = lines[i];
          line = line.trim();
          const m = creg.exec(line);
          if (m && m.groups) {
            cb(m.groups as any as MatchedGroups, i);
          }
      }
  }

    getCurrentTranslationLine(editor: vscode.TextEditor | undefined, lineNum?: number): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined] {
        if (!editor || !lineNum && !editor?.selection)
            return [false, undefined, undefined];
        lineNum = lineNum ?? editor.selection.active.line;
        const curLine = editor.document.lineAt(lineNum);
        const [, creg] = getRegex();
        if (!creg) {
            return [false, undefined, undefined];
        }
        const m = creg.exec(curLine.text)
        return !!m ? [true, curLine, m.groups as any as MatchedGroups] : [false, undefined, undefined];
    }

    getNextTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined] {
      if (!editor?.selection)
            return [false, undefined, undefined];
      const [, creg] = getRegex();
      if (!creg) {
        return [false, undefined, undefined];
      }
      const position = editor.selection.active;
      for (let i = 1; i <= 32 && position.line + i < editor.document.lineCount; i++) {
        const m = creg.exec(editor.document.lineAt(position.line + i).text)
        if (m && m.groups) {
          return [true, editor.document.lineAt(position.line + i), m.groups as any as MatchedGroups]
        }
      }
      return [false, undefined, undefined]
    }

    getPrevTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined] {
      if (!editor?.selection)
            return [false, undefined, undefined];
      const [, creg] = getRegex();
      if (!creg) {
        return [false, undefined, undefined];
      }
      const position = editor.selection.active;
      for (let i = 1; i <= 32 && position.line - i >= 0; i++) {
        const m = creg.exec(editor.document.lineAt(position.line - i).text)
        if (m && m.groups) {
          return [true, editor.document.lineAt(position.line - i), m.groups as any as MatchedGroups]
        }
      }
      return [false, undefined, undefined]
    }

    errorCheck(document: string | string[] | vscode.TextDocument): [boolean, vscode.Diagnostic[]] {
        const config = vscode.workspace.getConfiguration("dltxt");
        const checkPrefixTag = config.get<boolean>('appearance.showError.checkPrefixTag');
        const checkDeletedLines = config.get<boolean>('appearance.showError.checkDeletedLines');
        const diagnostics: vscode.Diagnostic[] = [];
        const valid_regs = getRegex();

        const lines = getLines(document);

        let matched_count = 0;
        let prev_matched_i = -1;

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const lineText = lines[lineNumber].trim();
            if (!lineText) {
                continue;
            }
            let matched = false;
            for(let i = 0; !matched && i < valid_regs.length; i++) {
                const reg = valid_regs[i];
                if (reg && reg.test(lineText)) {
                    if (checkDeletedLines) {
                        if (prev_matched_i == 0 && (i == 0 || i == 2)) {
                            diagnostics.push(createErrorDiagnostic('译文行被删除', lineNumber, lineText.length));
                        } else if (prev_matched_i == 1 && i == 1) {
                            diagnostics.push(createErrorDiagnostic('原文行被删除', lineNumber, lineText.length));
                        } else if (prev_matched_i == 2 && i == 1) {
                            diagnostics.push(createErrorDiagnostic('译文行被删除', lineNumber, lineText.length));
                        }
                    }
                    prev_matched_i = i;
                    matched = true;
                }
            }
            if (!matched) {
                if (checkPrefixTag) {
                    diagnostics.push(createErrorDiagnostic('标签格式错误', lineNumber, lineText.length));
                }
            } else {
                matched_count++;
            }
        }

        //在错误数小于正确数时才报告错误
        return [diagnostics.length < matched_count, diagnostics];
    }

    getFormatDetector() {
      return new StandardParserAutoDetector();
    }
}

////////////////////////End standard parser///////////////////////////////

function getLines(text: string | string[] | vscode.TextDocument): string[] {
  let lines = [];
  if (typeof text === 'string') {
    lines = text.split('\n');
  } else if (Array.isArray(text)) {
    lines = text;
  }
  else {
    lines = text.getText().split('\n');
  }
  return lines;
}


function getText(text: string | string[] | vscode.TextDocument): string {
  let lines = [];
  if (typeof text === 'string') {
    return text;
  } else if (Array.isArray(text)) {
    return text.join();
  }
  else {
    return text.getText();
  }
}


function checkValid(text: string): boolean[] {
  let stack: number[] = [];

  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === '『') {
      stack.push(i);
    }
    else if (c === '』') {
      if (stack.length > 0) {
        let k = stack.pop();
        if (k === 0) {
          if (i === text.length - 1) {
            return [true, true]
          }
        }
      } else if (i === text.length - 1) {
        return [false, true]
      }
    }
  }
  return [stack[0] === 0, false];
}
function adjust(jgrps: MatchedGroups, cgrps: MatchedGroups) {
  if (utils.contains(jgrps.white, '「') || utils.contains(jgrps.suffix, '」') || !jgrps.text)
    return;
  if (jgrps.text[0] !== '『' && jgrps.text[jgrps.text.length - 1] !== '』')
    return;
  const [prefix, suffix] = checkValid(jgrps.text);
  if (prefix || suffix) {
    if (prefix) {
      jgrps.white += '『';
      jgrps.text = jgrps.text.substring(1);
    }
    if (suffix) {
      jgrps.suffix = '』' + jgrps.suffix;
      jgrps.text = jgrps.text.substring(0, jgrps.text.length - 1);
    }
    if (prefix && !suffix) {
      let cm = cgrps.text.match(/^(?<a>[『“]?)(?<b>.*)$/)
      if (cm?.groups?.a) {
        cgrps.white += cm.groups.a;
        cgrps.text = cgrps.text.substring(1);
      }
    } else if (!prefix && suffix) {
      let cm = cgrps.text.match(/^(?<b>.*?)(?<c>[”』]?)$/)
      if (cm?.groups?.c) {
        cgrps.suffix = cm.groups.c + cgrps.suffix;
        cgrps.text = cgrps.text.substring(0, cgrps.text.length - 1);
      }
    } else if (prefix && suffix) {
      let cm = cgrps.text.match(/^(?<a>[『“]?)(?<b>.*?)(?<c>[”』]?)$/)
      if (cm?.groups?.a) {
        cgrps.white += cm.groups.a;
        cgrps.text = cgrps.text.substring(1);
      }
      if (cm?.groups?.c) {
        cgrps.suffix = cm.groups.c + cgrps.suffix;
        cgrps.text = cgrps.text.substring(0, cgrps.text.length - 1);
      }
    }
  }
}


////////////////////////////TextBlock////////////////////////////////

export class TextBlockDocumentParser implements DocumentParser {
  jreg: RegExp;
  creg: RegExp;
  jLineReg: RegExp;
  cLineReg: RegExp;
  constructor() {
    const [reg, jreg, creg] = getTextBlockRegex();
    if (!reg || !jreg || !creg) {
      throw new Error("reg or jreg or creg not defined");
    }
    this.jreg = jreg;
    this.creg = creg;
    const [jLineReg, cLineReg] = rewriteTextBlockRegex(reg);
    this.jLineReg = jLineReg;
    this.cLineReg = cLineReg;
  }
  warningCheck(document: string | string[] | vscode.TextDocument): vscode.Diagnostic[] {
    throw new Error('Method not implemented.');
  }


  processPairedLines(input: string | string[] | vscode.TextDocument, cb: (jgrps: MatchedGroups, cgrps: MatchedGroups, j_index: number, c_index: number) => void): void {
    const [reg] = getTextBlockRegex();
    const text = getText(input);
    const lineMap = generateLineMap(text);

    findAllAndProcess(reg, text, (match => {
      if (match.groups?.jp && match.groups?.cn) {
        const jm = this.jreg.exec(match.groups?.jp);
        const cm = this.creg.exec(match.groups?.cn);
        if (jm?.groups && cm?.groups) {
          const r_index = match.index;
          const blockIndex = queryLineNumber(lineMap, r_index);
          const j_offset = getLineOffset(this.jLineReg, match[0]);
          const c_offset = getLineOffset(this.cLineReg, match[0]);
          const jgrps = jm.groups as any as MatchedGroups;
          const cgrps = cm.groups as any as MatchedGroups;
          adjust(jgrps, cgrps);
          cb(jgrps, cgrps, blockIndex + j_offset, blockIndex + c_offset);
        }
      }
      return false;
    }))
  }

  processTranslatedLines(input: string | string[] | vscode.TextDocument, cb: (cgrps: MatchedGroups, c_index: number) => void): void {
    this.processPairedLines(input, (jgrps, cgrps, j_index, c_index) => {
      cb(cgrps, c_index);
    })
  }

  getCurrentTranslationLine(editor: vscode.TextEditor | undefined, lineNum?: number): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined] {
    if (!editor || !lineNum && !editor?.selection)
        return [false, undefined, undefined];
    lineNum = lineNum ?? editor.selection.active.line;
    const curLine = editor.document.lineAt(lineNum);
    const m = this.creg.exec(curLine.text)
    return !!m ? [true, curLine, m.groups as any as MatchedGroups] : [false, undefined, undefined];
  }
  getNextTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined] {
    if (!editor?.selection) {
      return [false, undefined, undefined];
    }
    const [reg] = getTextBlockRegex();
    const position = editor.selection.active;
    const istart = Math.max(0, position.line - 20);
    const searchText = editor.document.getText(new vscode.Range(
        position.with(istart, 0),
        position.with(position.line + 30, Number.MAX_SAFE_INTEGER)
      )
    )
    const lineMap = generateLineMap(searchText);
    let res: any[] = [false, undefined, undefined];
    findAllAndProcess(reg, searchText, (match) => {
      const blockLineNum = queryLineNumber(lineMap, match.index);
      const blockOffset = getLineOffset(this.cLineReg, match[0]);
      const lineNum = istart + blockLineNum + blockOffset;
      if (lineNum > position.line) {
        const m = this.creg.exec(editor.document.lineAt(lineNum).text)
        if (m && m.groups) {
          res = [true, editor.document.lineAt(lineNum), m.groups as any as MatchedGroups]
        }
        return true; //break
      }
      return false;
    })
    return res as [boolean, vscode.TextLine | undefined, MatchedGroups | undefined];
  }

  getPrevTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined] {
    if (!editor?.selection) {
      return [false, undefined, undefined];
    }
    const [reg] = getTextBlockRegex();
    const position = editor.selection.active;
    const istart = Math.max(0, position.line - 30);
    const searchText = editor.document.getText(new vscode.Range(
        position.with(istart, 0),
        position.with(position.line + 20, Number.MAX_SAFE_INTEGER)
      )
    )
    const lineMap = generateLineMap(searchText);
    let prevLineNum = -1;

    let res: any[] = [false, undefined, undefined];
    findAllAndProcess(reg, searchText, (match) => {
      const blockLineNum = queryLineNumber(lineMap, match.index);
      const blockOffset = getLineOffset(this.cLineReg, match[0]);
      const lineNum = istart + blockLineNum + blockOffset;
      if (lineNum >= position.line) {
        if (prevLineNum != -1) {
          const m = this.creg.exec(editor.document.lineAt(prevLineNum).text)
          if (m && m.groups) {
            res = [true, editor.document.lineAt(prevLineNum), m.groups as any as MatchedGroups]
          }
        }
        return true; //break
      } else {
        prevLineNum = lineNum;
      }
      return false;
    })
    return res as [boolean, vscode.TextLine | undefined, MatchedGroups | undefined];
  }

  errorCheck(document: string | string[] |vscode.TextDocument): [boolean, vscode.Diagnostic[]] {
    const diagnostics: vscode.Diagnostic[] = [];
    const lines = getLines(document);
    const ok = Array.from({ length: lines.length }).fill(false);
    const [reg] = getTextBlockRegex();
    const text = getText(document);
    const lineMap = generateLineMap(text);

    let matchedCount = 0;
    
    findAllAndProcess(reg, text, (match) => {
      matchedCount++;
      const blockLineNum = queryLineNumber(lineMap, match.index);
      const blockLen = match[0].split("\n").length;
      for(let i = 0; i < blockLen; i++) {
        ok[blockLineNum + i] = true;
      }
      if (!match.groups) {
        return false;
      }

      if (!this.jreg.test(match.groups.jp)) {
        const j_offset = getLineOffset(this.jLineReg, match[0]);
        diagnostics.push(createErrorDiagnostic('原文格式错误', blockLineNum + j_offset, Number.MAX_SAFE_INTEGER));
      }

      if (!this.creg.test(match.groups.cn)) {
        const c_offset = getLineOffset(this.cLineReg, match[0]);
        diagnostics.push(createErrorDiagnostic('译文格式错误', blockLineNum + c_offset, Number.MAX_SAFE_INTEGER));
      }

      return false;
    });

    let startError = -1;
    for(let i = 0; i < ok.length; i++) {
      if (!ok[i] && startError === -1) {
        startError = i;
      }
      if (ok[i] && startError !== -1) {
        diagnostics.push(createErrorDiagnosticMultiLine('段落格式错误', startError, i-1));
        startError = -1;
      }
    }
    if (startError != -1) {
      diagnostics.push(createErrorDiagnosticMultiLine('段落格式错误', startError, lines.length - 1));
    }
    return [diagnostics.length < matchedCount, diagnostics];
  }

  getFormatDetector(): AutoDetector {
    return new TextBlockAutoDetector();
  }
}

function generateLineMap(text: string): number[] {
  const lineStartIdx: number[] = [0]; //lineStartIdx[i] => start index (of text) of the i-th line
  for(let i = 1; i < text.length; i++) {
    if (text[i-1] === '\n') {
      lineStartIdx.push(i);
    }
  }
  return lineStartIdx;
}

function queryLineNumber(lineStartIdx: number[], idx: number) {
  let x = 0;
  for (let step = Math.floor(lineStartIdx.length/2); step > 0; step = Math.floor(step/2)) {
      while(x + step < lineStartIdx.length && lineStartIdx[x + step] <= idx) {
          x += step;
      }
  }
  return x;
}

function rewriteTextBlockRegex(reg: RegExp): [RegExp, RegExp] {
  const metaReg = /(?<pre>.*)(?<jpgroup>\(\?<jp>.*?\))/
  const mj = metaReg.exec(reg.source);
  const jpCatchRegStr = `(?<=${mj?.groups?.pre})${mj?.groups?.jpgroup}`;
  const jpCatchReg = new RegExp(jpCatchRegStr);

  const metaRegC = /(?<pre>.*)(?<cngroup>\(\?<cn>.*?\))/
  const mc = metaRegC.exec(reg.source);
  const cnCatchRegStr = `(?<=${mc?.groups?.pre})${mc?.groups?.cngroup}`;
  const cnCatchReg = new RegExp(cnCatchRegStr);

  return [jpCatchReg, cnCatchReg];
}

function getLineOffset(catchReg: RegExp, block: string): number {
  const m = catchReg.exec(block);
  if (!m) {
    throw new Error(`getLineOffset catchReg ${catchReg} cannot match block ${block}`);
  }
  return block.substring(0, m.index).split("\n").length - 1;
}

export let DocumentParser: DocumentParser = new StandardDocumentParser();
export function activate(context: vscode.ExtensionContext) {
  reloadDocumentParser();

  const disposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('dltxt.core')) {
      reloadDocumentParser();
    }
    context.subscriptions.push(disposable);
  });
}

function reloadDocumentParser() {
  const config = vscode.workspace.getConfiguration("dltxt.core");
  if (config.get("a.documentParser") === 'text-block') {
    DocumentParser = new TextBlockDocumentParser();
  } else {
    DocumentParser = new StandardDocumentParser();
  }
}

export enum NamePosition {
  Before = '行前',
  After = '行后', // TODO: implement
  Inline = '行内',
}

export function getTalkingNamePosition(): NamePosition {
  const config = vscode.workspace.getConfiguration("dltxt.core.name");
  const pos = config.get<string>('position');
  return NamePosition[pos as keyof typeof NamePosition] || NamePosition.Before;
}

export function getTalkingNameRegex(): RegExp| undefined {
  const config = vscode.workspace.getConfiguration("dltxt.core.name");
  const namePattern = config.get<string>('regex');
  if (namePattern) {
    return new RegExp(namePattern);
  }
  return undefined;
}

export function getDefaultTalkingName(): string {
  const config = vscode.workspace.getConfiguration("dltxt.core.name");
  const defaultName = config.get<string>('default');
  return defaultName || '';
}