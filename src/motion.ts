import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import * as utils from './utils';

function getTranslatedPrefixRegex() {
  const config = vscode.workspace.getConfiguration("dltxt");
  return config.get('core.translatedTextPrefixRegex')
}
function getSkipCharsSet() {
  const config = vscode.workspace.getConfiguration("dltxt");
  const skipCharsStr = config.get('core.z.skipCharsPrefix') as string;
  let skipCharsSet =  new Set<string>();
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
    let reg = new RegExp(`(?<=${translatedPrefixRegex}).*`,'m');
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
    let reg = new RegExp(`(?<=${translatedPrefixRegex}).*`,'m');
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
    const text = editor.document.getText(new vscode.Range(c, c.with(c.line, c.character+2)));
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
    const text = editor.document.getText(new vscode.Range(c, c.with(c.line, c.character-2)));
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
    if(config.get('motion.moveToNextLine.moveCursor') as boolean) {
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
  if (doDelete && curLine.search(pattern) == -1)
    return;

  const curLineAfter = curLine.substring(position.character);

  let iend = position.character + curLineAfter.length;
  if (all) {
    const pattern = /」|』/;
    while(iend >= 0 && pattern.test(curLine[iend-1])) {
      iend--;
    }
  } else {
    const delimMatch = getTextDelimiter().exec(curLineAfter)
    if (delimMatch) {
      iend = position.character + delimMatch.index;
    }
    if (iend == position.character) {
      iend++;
    }
  }
  
  if (doDelete) {
    const toDelete = new vscode.Range(
      position.with(position.line, position.character),
      position.with(position.line, iend)
    );
    editor.edit((editbuilder) => {
      editbuilder.delete(toDelete);
    });
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
  if (i == curChar) {
    i--;
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