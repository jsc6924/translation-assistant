import * as vscode from 'vscode';
import { repeatStr, toAscii, toDBC } from './utils';
import { getTextDelimiter } from './motion';
import { findLastMatchIndex } from './utils';
import { DocumentParser, MatchedGroups, getRegex } from './parser';



function editTranslation(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  ops: Array<CallableFunction>
) {
  const result: vscode.TextEdit[] = [];
  const config = vscode.workspace.getConfiguration("dltxt");
  const debugMode = config.get("formatter.z.debugMode") as boolean;

  DocumentParser.processPairedLines(document, (jgrps, cgrps, j_index, c_index) => {
    const line = document.lineAt(j_index);
    const nextLine = document.lineAt(c_index);
    let nextLineText = nextLine.text;

    for (let op of ops) {
      op(jgrps, cgrps);
    }

    if (debugMode) {
      const curLineText = `${jgrps?.prefix}{${jgrps?.white}}{${jgrps?.text}}{${jgrps?.suffix}}`
      result.push(vscode.TextEdit.replace(line.range, curLineText));
      nextLineText = `${cgrps?.prefix}{${cgrps?.white}}{${cgrps?.text}}{${cgrps?.suffix}}`
      result.push(vscode.TextEdit.replace(nextLine.range, nextLineText));
    } else {
      nextLineText = `${cgrps?.prefix}${cgrps?.white}${cgrps?.text}${cgrps?.suffix}`
      if (nextLineText !== nextLine.text) {
        result.push(vscode.TextEdit.replace(nextLine.range, nextLineText));
      }
    }
  })

  return result;
}

export function formatter(context: vscode.ExtensionContext, document: vscode.TextDocument): vscode.TextEdit[] {
  const config = vscode.workspace.getConfiguration("dltxt");
  const ops: Array<CallableFunction> = [];
  const padding = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    cgrps.white = jgrps.white;
    if (jgrps.suffix && !cgrps.suffix) {
      const reg = new RegExp(`(.*${jgrps.suffix[0]})([(（].*[）)])?(.*)`);
      let m = reg.exec(cgrps.text);
      if (m && m[2]) {
        cgrps.text = `${m[1]}${m[2]}${jgrps.suffix.substring(1)}`
      } else {
        cgrps.suffix = jgrps.suffix;
      }
    } else {
      cgrps.suffix = jgrps.suffix;
    }
  };
  if (config.get("formatter.a.padding"))
    ops.push(padding);

  const ellipsis = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    let target = config.get("formatter.a.ellipsis.specify") as string;
    text = text.replace(/\.{2,}/g, target);
    text = text.replace(/。{2,}/g, target);
    cgrps.text = text;
  };
  if (config.get("formatter.a.ellipsis.enable"))
    ops.push(ellipsis);

  const wave = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let target = config.get("formatter.a.wave.specify") as string;
    cgrps.text = cgrps.text.replace(/[~∼〜～]/g, target);
  };
  if (config.get("formatter.a.wave.enable"))
    ops.push(wave);

  const horizontalLine = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    let target = '—';
    text = text.replace(/[—―ー－]{2,}/g, s => repeatStr(target, s.length, false));
    text = text.replace(/-{2,}/g, s => repeatStr(target, Math.max(2, Math.ceil(s.length / 2)), false));
    cgrps.text = text;
  };
  if (config.get("formatter.a.horizontalLine.enable"))
    ops.push(horizontalLine);

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

  const puncMap: Array<Array<any>> = [
    ['\\,', '，'],
    ['\\.', '。'],
    ['\\:', '：'],
    ['\\;', '；'],
    ['\\!', '！'],
    ['\\?', '？'],
    ['\\(', '（'],
    ['\\)', '）'],
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
  if (config.get("formatter.b.h2fPunc"))
    ops.push(h2fPunc);

  const quoteStype = config.get("formatter.b.formatQuote.specify") as string;
  const leftQuote = quoteStype[0];
  const rightQuote = quoteStype[quoteStype.length - 1]
  const quoteMap: Array<Array<any>> = [
    ['『', leftQuote],
    ['』', rightQuote],
    ['“', leftQuote],
    ['”', rightQuote],
  ];
  for (let entry of quoteMap) {
    let reg = new RegExp(entry[0], 'g');
    entry.push(reg);
  }
  const formatQuote = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    for (const [key, val, reg] of quoteMap) {
      text = text.replace(reg, val);
    }
    cgrps.text = text;
  };
  if (config.get("formatter.b.formatQuote.enable"))
    ops.push(formatQuote);

  const h2fAlpha = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    let regAplha = /[0-9a-zA-Z]/g;
    let match;
    while (match = regAplha.exec(text)) {
      text = text.replace(match[0], toDBC(match[0]));
    }
    cgrps.text = text;
  };
  const h2fAscii = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    let regAplha = /[０-９ａ-ｚＡ-Ｚ]/g;
    let match;
    while (match = regAplha.exec(text)) {
      text = text.replace(match[0], toAscii(match[0]));
    }
    cgrps.text = text;
  };
  const h2fOption = config.get("formatter.b.h2fAlpha")
  if (h2fOption === '统一为全角' || h2fOption === true) {
    ops.push(h2fAlpha);
  } else if (h2fOption === '统一为半角') {
    ops.push(h2fAscii);
  }


  const omitPeriod = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    if (cgrps?.suffix.startsWith('」') || cgrps?.suffix.startsWith('』')) {
      cgrps.text = cgrps.text.replace(/(?<![\.。])[\.。]$/g, '');
    }
  };
  if (config.get("formatter.c.omitPeriod"))
    ops.push(omitPeriod);

  
  const removeEllipsisPeriod = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    cgrps.text = cgrps.text.replace(/……。/g, '……');
  };
  if (config.get("formatter.c.removeEllipsisPeriod"))
    ops.push(removeEllipsisPeriod);

  const removeEllipsisQE = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    cgrps.text = cgrps.text.replace(/……？/g, '？');
    cgrps.text = cgrps.text.replace(/……！/g, '！');
  };
  if (config.get("formatter.c.removeEllipsisQE"))
    ops.push(removeEllipsisQE);

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

export function copyOriginalToTranslation(context: vscode.ExtensionContext, document: vscode.TextDocument, editBuilder: vscode.TextEditorEdit) {
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

export function repeatFirstChar(context: vscode.ExtensionContext, editor: vscode.TextEditor, editBuilder: vscode.TextEditorEdit) {
  const cur = editor.selection.start;
  let curChar = cur.character;
  const delimiterPattern = getTextDelimiter();

  const rep = (cgrps: MatchedGroups) => {
    let text: string = cgrps.text as string;
    let textLeft = text.substring(0, curChar - cgrps.prefix.length - cgrps.white.length);
    let i = findLastMatchIndex(delimiterPattern, textLeft);
    if (i == -1) {
      i = 0;
    } else {
      const match = delimiterPattern.exec(textLeft.substring(i));
      if (!match) {
        return;
      }
      i += match[0].length;
    }
    if (i < text.length) {
      const t1 = text.substring(0, i);
      const t2 = text.substring(i, i + 1);
      const t3 = text.substring(i);
      text = t1 + t2 + '、' + t3;
    }
    cgrps.text = text;
  }

  const [ok, curLine, cgrps] = DocumentParser.getCurrentTranslationLine(vscode.window.activeTextEditor);
  if (!ok || !curLine || !cgrps) {
    return;
  }
  rep(cgrps);
  const newLine = `${cgrps?.prefix}${cgrps?.white}${cgrps?.text}${cgrps?.suffix}`
  editBuilder.replace(curLine.range, newLine);

}


