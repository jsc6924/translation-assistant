import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import * as utils from './utils';
import { getRegex } from './formatter';

function getTranslatedPrefixRegex() {
  const config = vscode.workspace.getConfiguration("dltxt");
  return config.get('core.translatedTextPrefixRegex')
}
function getSkipCharsSet() {
  const config = vscode.workspace.getConfiguration("dltxt");
  const skipCharsStr = config.get('core.z.skipCharsPrefix') as string;
  let skipCharsSet = new Set<string>();
  for (let i = 0; i < skipCharsStr.length; i++) {
    skipCharsSet.add(skipCharsStr[i]);
  }
  return skipCharsSet;
}
export function getTextDelimiter() {
  const config = vscode.workspace.getConfiguration("dltxt");
  const suffixPatternStr = config.get('core.z.textDelimiter') as string;
  try {
    const translatedSuffixRegex = new RegExp(suffixPatternStr, 'g');
    return translatedSuffixRegex;
  } catch (e) {
    vscode.window.showErrorMessage(`${e}`);
  }
  return new RegExp('[，。、？！…—；：“”‘’~～\\s　「」『』\\[\\]\\(\\)（）【】]', 'g');
}
const INT_MAX = Number.MAX_SAFE_INTEGER;

export function getCurrentLine() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document)
    return "";
  const position = editor.selection.active;
  if (!position)
    return "";
  return editor.document.getText(
    new vscode.Range(
      new vscode.Position(position.line, 0),
      position
    )
  );
}

export function cursorToLineHead() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.selection.isEmpty) {
    const position = editor.selection.active;
    const searchTxt = editor.document.getText(
      new vscode.Range(
        position.with(position.line, 0),
        position.with(position.line, INT_MAX)
      )
    );

    const translatedPrefixRegex = getTranslatedPrefixRegex();
    let reg = new RegExp(`(?<=${translatedPrefixRegex}).*`, 'm');
    const idx = searchTxt.search(reg);
    if (idx >= 0) {
      let m = utils.countCharBeforeNewline(searchTxt, idx);
      m += utils.countStartingUnimportantChar(searchTxt, idx, getSkipCharsSet());
      utils.setCursorAndScroll(editor, 0, m);
    }
  }
}

export function cursorToNextLine() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.selection.isEmpty) {
    const sStart = editor.selection.start.with(editor.selection.start.line + 1, 0);
    const sEnd = editor.selection.start.with(editor.selection.start.line + 16);
    const searchTxt = editor.document.getText(new vscode.Range(sStart, sEnd));

    const translatedPrefixRegex = getTranslatedPrefixRegex();
    let reg = new RegExp(`(?<=${translatedPrefixRegex}).*`, 'm');
    const idx = searchTxt.search(reg);
    if (idx >= 0) {
      let m = utils.countCharBeforeNewline(searchTxt, idx);
      m += utils.countStartingUnimportantChar(searchTxt, idx, getSkipCharsSet());
      let n = utils.countLineUntil(searchTxt, idx);
      utils.setCursorAndScroll(editor, n, m);
    }
  }
}

export function cursorToNextWord() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.selection.isEmpty) {
    const c = editor.selection.start;
    const text = editor.document.getText(new vscode.Range(c, c.with(c.line, c.character + 2)));
    if (text === '……') {
      utils.setCursorAndScroll(editor, 0, c.character + 2, false);
    }
    else {
      let k = c.character < editor.document.lineAt(c.line).text.length ? 1 : 0;
      utils.setCursorAndScroll(editor, 0, c.character + k, false);
    }
  }
}
export function cursorToPrevWord() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.selection.isEmpty) {
    const c = editor.selection.start;
    if (c.character === 0) {
      return;
    }
    if (c.character === 1) {
      utils.setCursorAndScroll(editor, 0, c.character - 1, false);
      return;
    }
    const text = editor.document.getText(new vscode.Range(c, c.with(c.line, c.character - 2)));
    if (text === '……')
      utils.setCursorAndScroll(editor, 0, c.character - 2, false);
    else
      utils.setCursorAndScroll(editor, 0, c.character - 1, false);
  }
}



export function cursorToPrevLine() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.selection.isEmpty) {
    const startLine = Math.max(0, editor.selection.start.line - 16);
    const endLine = Math.max(0, editor.selection.start.line - 1);
    const sStart = editor.selection.start.with(startLine, 0);
    const sEnd = editor.selection.start.with(endLine, 100);
    const searchTxt = editor.document.getText(new vscode.Range(sStart, sEnd));
    const translatedPrefixRegex = getTranslatedPrefixRegex();
    const pattern = new RegExp(`(?<=${translatedPrefixRegex}).*`, 'gm');
    let startIdx = utils.findLastMatchIndex(pattern, searchTxt);
    if (startIdx != -1) {
      let m = utils.countCharBeforeNewline(searchTxt, startIdx);
      m += utils.countStartingUnimportantChar(searchTxt, startIdx, getSkipCharsSet());
      let n = utils.countLineFrom(searchTxt, startIdx);
      utils.setCursorAndScroll(editor, -n, m);
    }
  }
}


export function moveToNextLine() {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;
  const translatedPrefixRegex = getTranslatedPrefixRegex();
  const pattern = new RegExp(`(?<=${translatedPrefixRegex}).*`, 'm');
  const curLine = getCurrentLine();
  if (curLine.search(pattern) == -1)
    return;
  const sStart = editor.selection.start.with(editor.selection.start.line + 1, 0);
  const sEnd = editor.selection.start.with(editor.selection.start.line + 16);
  const searchTxt = editor.document.getText(new vscode.Range(sStart, sEnd));

  const idx = searchTxt.search(pattern);
  if (idx >= 0) {
    let m = utils.countCharBeforeNewline(searchTxt, idx);
    m += utils.countStartingUnimportantChar(searchTxt, idx, getSkipCharsSet());
    let n = utils.countLineUntil(searchTxt, idx);
    const position = editor.selection.active;
    const toMove = new vscode.Range(
      position.with(position.line, position.character),
      position.with(position.line, INT_MAX));
    const toInsert = new vscode.Position(
      position.line + n, m
    );
    let sline = editor.document.getText(toMove);
    editor.edit((editbuilder) => {
      editbuilder.delete(toMove);
      editbuilder.insert(toInsert, sline);
    });
    const config = vscode.workspace.getConfiguration("dltxt");
    if (config.get('motion.moveToNextLine.moveCursor') as boolean) {
      utils.setCursorAndScroll(editor, n, m + sline.length);
    }
  }
}

export function deleteUntil(all: boolean, doDelete: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;
  const translatedPrefixRegex = getTranslatedPrefixRegex();
  const pattern = new RegExp(`(?<=${translatedPrefixRegex}).*`, 'm');
  const position = editor.selection.active;
  const curLine = editor.document.getText(
    new vscode.Range(
      position.with(position.line, 0),
      position.with(position.line, INT_MAX)
    )
  );
  if (doDelete) {
    if (curLine.search(pattern) == -1) {
      return;
    }
    if (!editor.selection.isEmpty) {
      editor.edit((editbuilder) => {
        editbuilder.delete(editor.selection);
      });
      return;
    }
  }

  const curLineAfter = curLine.substring(position.character);

  let iend = position.character + curLineAfter.length;
  const getLastQuote = () => {
    let last = position.character + curLineAfter.length;
    const pattern = /」|』/;
    for (let i = position.character; i < curLine.length; i++) {
      if (pattern.test(curLine[i])) {
        last = i;
      }
    }
    return last;
  }
  if (all) {
    iend = getLastQuote();
  } else {
    const lastQuote = getLastQuote();
    const delimMatch = getTextDelimiter().exec(curLineAfter)
    if (delimMatch) {
      iend = position.character + delimMatch.index;
    }
    if (iend == position.character) {
      iend++;
    }

    const text = editor.document.getText(new vscode.Range(
      position.with(position.line, iend-1), position.with(position.line, iend+1)));
    if (text === '……') {
      iend++;
    }
    if (iend > lastQuote) {
      iend = lastQuote;
    }
  }

  if (doDelete) {
    if (position.character < iend) {
      const toDelete = new vscode.Range(
        position.with(position.line, position.character),
        position.with(position.line, iend)
      );
      editor.edit((editbuilder) => {
        editbuilder.delete(toDelete);
      });
    }
  } else {
    const newPosition = position.with(position.line, iend);
    editor.selection = new vscode.Selection(newPosition, newPosition);
  }
}

export function cursorToSublineHead() {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;

  const delimiterPattern = getTextDelimiter();
  const position = editor.selection.active;
  const curLine = editor.document.getText(
    new vscode.Range(
      position.with(position.line, 0),
      position.with(position.line, INT_MAX)
    )
  );
  const translatedPrefixRegex = getTranslatedPrefixRegex();
  const pattern = new RegExp(`(${translatedPrefixRegex}).*`, 'm');
  const transMatch = pattern.exec(curLine);
  const prefixLen = transMatch ? transMatch[1].length : 0;

  const curChar = position.character;
  let textLeft = curLine.substring(0, curChar);
  let i = utils.findLastMatchIndex(delimiterPattern, textLeft);
  if (i == -1) {
    i = 0;
  } else {
    const match = delimiterPattern.exec(textLeft.substring(i));
    if (!match) {
      return;
    }
    i += match[0].length;
  }
  if (i == curChar && i > 0) {
    i--;
    const text = editor.document.getText(new vscode.Range(
      position.with(position.line, i-1), position.with(position.line, i+1)));
    if (text === '……') {
      i--;
    }
  }
  if (i < prefixLen) {
    i = prefixLen;
  }
  const newPosition = position.with(position.line, i);
  editor.selection = new vscode.Selection(newPosition, newPosition);
}


export function moveToPrevLine() {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;
  const startLine = Math.max(0, editor.selection.start.line - 16);
  const endLine = Math.max(0, editor.selection.start.line - 1);
  const sStart = editor.selection.start.with(startLine, 0);
  const sEnd = editor.selection.start.with(endLine, INT_MAX);
  const searchTxt = editor.document.getText(new vscode.Range(sStart, sEnd));
  const translatedPrefixRegex = getTranslatedPrefixRegex();
  const pattern = new RegExp(`(?<=${translatedPrefixRegex}).*`, 'gm');
  let idx = utils.findLastMatchIndex(pattern, searchTxt);
  if (idx != -1) {
    let n = utils.countLineFrom(searchTxt, idx);
    const position = editor.selection.active;
    const strThisLine = getCurrentLine();
    let t = strThisLine.search(pattern);
    if (t == -1)
      return;
    t += utils.countStartingUnimportantChar(strThisLine, t, getSkipCharsSet());
    const toMove = new vscode.Range(
      position.with(position.line, t),
      position.with(position.line, position.character))
    const toInsert = new vscode.Position(
      position.line - n, INT_MAX
    );
    let sline = editor.document.getText(toMove);
    editor.edit((editbuilder) => {
      editbuilder.delete(toMove);
      editbuilder.insert(toInsert, sline);
    });
  }
}

function repeatStr(s: string, k: number, addSuffix: boolean): string {
  let res = '';
  let n = k;
  while(k>0) {
    res += s;
    k--;
  }
  if (addSuffix && n > 1) {
    res += '～';
  }
  return res;
}

const lineTranslateTable = new Map<RegExp, string | ((arg: string)=>string) >([
    [/っ/g, ''],
    [/[れぺ][ろる]/g, (s)=>'啾' + repeatStr('噜',s.length-1, false)],
    [/[ぴぷ]ち[ゃゅ]/g, '噗啾'],
    [/[ちじぢ]ゅ[うぅ]?/g, '啾'],
    [/りゅ/g, '噜'],
    [/[こご]くん/g, '咕噜'],
    [/びゅ[く]?/g, (s)=>repeatStr('咻',s.length, false)],
    [/びゅる+/g, (s)=>'咻' + repeatStr('噜',s.length-1, false)],
    [/ど[ぷく]+/g, (s)=>'咻' + repeatStr('噗',s.length-1, false)],
    [/や[あぁ]*/g, (s)=>'呀'+repeatStr('啊',s.length-1, true)],
    [/[あぁ]+/g, (s)=>repeatStr('啊',s.length, true)],
    [/[おぉ]+/g, (s)=>repeatStr('哦',s.length, true)],
    [/ず+/g, (s)=>repeatStr('滋',s.length, false)],
    [/ふう?/g, '呼'],
    [/う(?=あ)/g, '哇'],
    [/[うぅ]+/g, (s)=>repeatStr('呜',s.length, true)],
    [/[ひき][ゃ]?/g, '呀'],
    [/く/g, '库'],
    [/ぐ/g, '咕'],
    [/ぬ/g, '努'],
    [/ぱ[ん]?/g, '啪'],
    [/は[ん]?/g, '哈'],
    [/ぷ[ん]?/g, '噗'],
    [/む[ん]?/g, '姆'],
    [/る/g, '噜'],
    [/ん+/g, (s)=>repeatStr('嗯',s.length, true)],
]);

export function translateCurrentLine() {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;
  const position = editor.selection.active;
  const curLine = editor.document.getText(
    new vscode.Range(
      position.with(position.line, 0),
      position.with(position.line, INT_MAX)
    )
  );
  const translatedPrefixRegex = getTranslatedPrefixRegex();
  const pattern = new RegExp(`(${translatedPrefixRegex}).*`, 'm');
  const transMatch = pattern.exec(curLine);
  if (!transMatch) {
    return;
  }
  let replacedLine = curLine;
  for (const [k,v] of lineTranslateTable) {
    if (typeof v == "string") {
      replacedLine = replacedLine.replace(k, v);
    } else {
      replacedLine = replacedLine.replace(k, v);
    }
  }
  editor.edit((editbuilder) => {
    const range = new vscode.Range(
      position.with(position.line, 0),
      position.with(position.line, INT_MAX)
    );
    editbuilder.replace(range, replacedLine);
  });
}

export function editorWriteString(s: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;
    editor.edit((editbuilder) => {
      if (editor.selection.start != editor.selection.end) {
        editbuilder.replace(editor.selection, s);
      } else {
        editbuilder.insert(editor.selection.active, s);
      }
    });
}