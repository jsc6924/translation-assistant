import * as vscode from 'vscode';
import { toDBC, contains } from './utils';

export function getRegex() {
  const config = vscode.workspace.getConfiguration("dltxt");
  const jPreStr = config.get('core.originalTextPrefixRegex') as string;
  const cPreStr = config.get('core.translatedTextPrefixRegex') as string;
  const oPreStr = config.get('core.otherPrefixRegex') as string;
  if (!jPreStr || !cPreStr) {
    return [undefined, undefined];
  }
  const jreg = new RegExp(`^(?<prefix>${jPreStr})(?<white>\\s*[「]?)(?<text>.*?)(?<suffix>[」]?)$`);
  const creg = new RegExp(`^(?<prefix>${cPreStr})(?<white>\\s*[「]?)(?<text>.*?)(?<suffix>[」]?)$`);
  const oreg = oPreStr ? new RegExp(`^(?<prefix>${oPreStr})(?<white>\\s*[「]?)(?<text>.*?)(?<suffix>[」]?)$`) : undefined;
  return [jreg, creg, oreg];
}

export interface MatchedGroups {
  prefix: string;
  white: string;
  text: string;
  suffix: string;
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
  if (contains(jgrps.white, '「') || contains(jgrps.suffix, '」') || !jgrps.text)
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
        cgrps.suffix += cm.groups.c;
        cgrps.text = cgrps.text.substring(0, cgrps.text.length - 1);
      }
    } else if (prefix && suffix) {
      let cm = cgrps.text.match(/^(?<a>[『“]?)(?<b>.*?)(?<c>[”』]?)$/)
      if (cm?.groups?.a) {
        cgrps.white += cm.groups.a;
        cgrps.text = cgrps.text.substring(1);
      }
      if (cm?.groups?.c) {
        cgrps.suffix += cm.groups.c;
        cgrps.text = cgrps.text.substring(0, cgrps.text.length - 1);
      }
    }
  }
}

function editTranslation(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  ops: Array<CallableFunction>,
  lines?: Array<number>
) {
  const [jreg, creg, oreg] = getRegex();
  if (!jreg || !creg)
    return [];
  const result = [];
  if (!lines) {
    lines = [...Array(document.lineCount).keys()];
  }
  for (let i of lines) {
    const line = document.lineAt(i);
    const jmatch = jreg.exec(line.text);
    if (jmatch && i + 1 < document.lineCount) {
      const jgrps = jmatch.groups as any as MatchedGroups;
      const nextLine = document.lineAt(i + 1);
      let nextLineText = nextLine.text;
      const cmatch = creg.exec(nextLineText);
      const cgrps = cmatch?.groups as any as MatchedGroups;
      if (!jgrps || !cgrps)
        continue;
      adjust(jgrps, cgrps);
      for (let op of ops) {
        op(jgrps, cgrps);
      }
      nextLineText = `${cgrps?.prefix}${cgrps?.white}${cgrps?.text}${cgrps?.suffix}`
      result.push(vscode.TextEdit.replace(nextLine.range, nextLineText));
    }
  }
  return result;
}

export function formatter(context: vscode.ExtensionContext, document: vscode.TextDocument): vscode.TextEdit[] {
  const config = vscode.workspace.getConfiguration("dltxt");
  const ops: Array<CallableFunction> = [];
  const padding = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    if (contains(jgrps.text, '「') || contains(jgrps.text, '」'))
      return;
    cgrps.white = jgrps.white;
    cgrps.suffix = jgrps.suffix;
  };
  if(config.get("formatter.a.padding"))
    ops.push(padding);

  const ellipsis = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    let target = config.get("formatter.a.ellipsis.specify") as string;
    text = text.replace(/\.{2,}/g, target);
    text = text.replace(/。{2,}/g, target);
    cgrps.text = text;
  };
  if(config.get("formatter.a.ellipsis.enable"))
    ops.push(ellipsis);

  const wave = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let target = config.get("formatter.a.wave.specify") as string;
    cgrps.text = cgrps.text.replace(/[~∼〜～]/g, target);
  };
  if(config.get("formatter.a.wave.enable"))
    ops.push(wave);

  const horizontalLine = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    let target = config.get("formatter.a.horizontalLine.specify") as string;
    text = text.replace(/[ー－\-]+/g, target);
    cgrps.text = text;
  };
  if(config.get("formatter.a.horizontalLine.enable"))
    ops.push(horizontalLine);


  const puncMap: Array<Array<any>> = [
    ['\\,', '，'],
    ['\\.', '。'],
    ['\\:', '：'],
    ['\\;', '；'],
    ['\\!', '！'],
    ['\\?', '？'],
    ['\\(', '（'],
    ['\\)', '）'],
    ['『', '“'],
    ['』', '”'],
    ['\\s', '　'],
  ];
  for (let entry of puncMap) {
    let reg = new RegExp(entry[0], 'g');
    entry.push(reg);
  }
  const h2fPunc = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    for (const [key, val, reg] of puncMap) {
      text = text.replace(reg, val);
    }
    cgrps.text = text;
  };
  if(config.get("formatter.b.h2fPunc"))
    ops.push(h2fPunc);

  const h2fAlpha = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    let regAplha = /[0-9a-zA-Z]/g;
    let match;
    while (match = regAplha.exec(text)) {
      text = text.replace(match[0], toDBC(match[0]));
    }
    cgrps.text = text;
  };
  if(config.get("formatter.b.h2fAlpha"))
  ops.push(h2fAlpha);
  
  function fixReversedQuote(qStart: string, qEnd: string, qAlter?: string) {
    return (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
      let text: string = cgrps.text as string;
      let state = false;
      let possibleText = '';
      for (let i = 0; i < text.length; i++) {
        if (text[i] === qStart || text[i] === qEnd || text[i] === qAlter) {
          possibleText += state ? qEnd : qStart;
          state = !state;
        } else {
          possibleText += text[i];
        }
      }
      if (!state) {
        text = possibleText;
      }
      cgrps.text = text;
    };
  }
  if (config.get("formatter.b.fixReversedQuote")) {
    ops.push(fixReversedQuote('“', '”', '"'));
    ops.push(fixReversedQuote('‘', '’', "'"));
  }

  const omitPeriod = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    if (cgrps?.suffix === '」' || cgrps?.suffix === '』') {
      cgrps.text = cgrps.text.replace(/(?<![\.。])[\.。]$/g, '');
    }
  };
  if(config.get("formatter.c.omitPeriod"))
    ops.push(omitPeriod);

  const customMappingFunc = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    const nameMapping = config.get("formatter.d.customMapping") as object
    if (cgrps?.text) {
      for (const [key, value] of Object.entries(nameMapping)) {
        cgrps.text = cgrps.text.replace(new RegExp(`${key}`, 'g'), value);
      }
    }
  }
  ops.push(customMappingFunc);


  return editTranslation(context, document, ops);
}

export function copyOriginalToTranslation(context: vscode.ExtensionContext, document: vscode.TextDocument, editBuilder: vscode.TextEditorEdit){
  const ops: Array<CallableFunction> = [];
  const copy = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    if (!cgrps?.text) {
      cgrps.white = jgrps.white;
      cgrps.text = jgrps.text;
      cgrps.suffix = jgrps.suffix;
    }
  };
  ops.push(copy);
  editTranslation(context, document, ops).forEach(edit => {
    editBuilder.replace(edit.range, edit.newText);
  });
}
export function repeatFirstChar(context: vscode.ExtensionContext, editor: vscode.TextEditor, editBuilder: vscode.TextEditorEdit){

  const document = editor.document;
  const cur = editor.selection.start;
	const curLine = document.lineAt(editor.selection.start.line)
  let curChar = cur.character;
  const rep = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    let i = curChar - cgrps?.prefix.length - cgrps?.white.length;
    while (i > 0 && i - 1 < text.length && text[i - 1].match(/[^，。、？！…—；：“”‘’~～「」「」\[\]\(\)（）【】]/)) {
      i--;
    }
    if (i < text.length) {
      text = text.substr(0, i) + text.substr(i, 1) + '、' + text.substr(i);
    }
    cgrps.text = text;
  }
  editTranslation(context, document, [rep], [curLine.lineNumber - 1])
    .forEach(edit => { editBuilder.replace(edit.range, edit.newText) });
}


