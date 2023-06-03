import * as vscode from "vscode";

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