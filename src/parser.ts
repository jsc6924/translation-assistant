import * as vscode from 'vscode';
import { createErrorDiagnostic } from './error-check';
import * as utils from './utils';
import { AutoDetector, StandardParserAutoDetector } from './auto-format';

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

export interface MatchedGroups {
    prefix: string;
    white: string;
    text: string;
    suffix: string;
}

////////////////////////Start standard parser///////////////////////////////

interface DocumentParser {
  processPairedLines(text: string | string[] | vscode.TextDocument, cb: (jgrps: MatchedGroups, cgrps: MatchedGroups, j_index: number, c_index: number) => void): void;

  processTranslatedLines(text: string | string[] | vscode.TextDocument, cb: (cgrps: MatchedGroups, c_index: number) => void): void;

  getCurrentTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined];

  getNextTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined];

  getPrevTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined];

  errorCheck(document: vscode.TextDocument): [boolean, vscode.Diagnostic[]];

  getFormatDetector(): AutoDetector;
}

class StandardDocumentParser {
    constructor() {

    }

    processPairedLines(text: string | string[] | vscode.TextDocument, cb: (jgrps: MatchedGroups, cgrps: MatchedGroups, j_index: number, c_index: number) => void) {
        const [jreg, creg] = getRegex();
        if (!jreg || !creg) {
            throw new Error('jreg or creg undefined');
        }
        let lines = getLines(text);
        let jgrps: MatchedGroups | undefined;
        let j_index = -1;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            line = line.trim();
            const m = jreg.exec(line);
            if (m && m.groups) {
                if (!!jgrps) {
                    throw new Error(`Unmatched jgrps: ${jgrps}`)
                }
                jgrps = m.groups as any as MatchedGroups;
                j_index = i;
            } else {
                const m = creg.exec(line);
                if (m && m.groups && jgrps) {
                    const cgrps = m.groups as any as MatchedGroups;
                    adjust(jgrps, cgrps);
                    cb(jgrps, cgrps, j_index, i);
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

    getCurrentTranslationLine(editor: vscode.TextEditor | undefined): [boolean, vscode.TextLine | undefined, MatchedGroups | undefined] {
        if (!editor?.selection)
            return [false, undefined, undefined];
        const curLine = editor.document.lineAt(editor.selection.active.line);
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

    errorCheck(document: vscode.TextDocument): [boolean, vscode.Diagnostic[]] {
        const config = vscode.workspace.getConfiguration("dltxt");
        const checkPrefixTag = config.get<boolean>('appearance.showError.checkPrefixTag');
        const checkDeletedLines = config.get<boolean>('appearance.showError.checkDeletedLines');
        const diagnostics: vscode.Diagnostic[] = [];
        const valid_regs = getRegex();

        let matched_count = 0;
        let prev_matched_i = -1;

        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            const lineText = document.lineAt(lineNumber).text;
            if (!lineText) {
                continue;
            }
            let matched = false;
            for(let i = 0; !matched && i < valid_regs.length; i++) {
                const reg = valid_regs[i];
                if (reg && reg.test(lineText)) {
                    if (checkDeletedLines) {
                        if (i == 0 && prev_matched_i == 0) {
                            diagnostics.push(createErrorDiagnostic('译文行被删除', lineNumber, lineText.length));
                        } else if (i == 1 && prev_matched_i == 1) {
                            diagnostics.push(createErrorDiagnostic('原文行被删除', lineNumber, lineText.length));
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


export let DocumentParser = new StandardDocumentParser();