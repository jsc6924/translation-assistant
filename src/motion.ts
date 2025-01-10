import * as vscode from 'vscode';
import * as utils from './utils';
import { DocumentParser } from './parser';
import { DictSettings, registerCommand, repeatStr } from './utils';
import { DecorationMemoryStorage } from './simpletm';

export function activate(context: vscode.ExtensionContext) {
	registerCommand(context, 'Extension.dltxt.cursorToLineHead', cursorToLineHead);
	registerCommand(context, 'Extension.dltxt.cursorToLineEnd', cursorToLineEnd);
  registerCommand(context, 'Extension.dltxt.cursorToNextLine', () => cursorToNextLine(false));
  registerCommand(context, 'Extension.dltxt.cursorToNextLineNested', () => cursorToNextLine(true));
	registerCommand(context, 'Extension.dltxt.cursorToPrevLine', () => cursorToPrevLine(false));
	registerCommand(context, 'Extension.dltxt.cursorToPrevLineNested', () => cursorToPrevLine(true));
	registerCommand(context, 'Extension.dltxt.cursorToNextWord', cursorToNextWord);
	registerCommand(context, 'Extension.dltxt.cursorToPrevWord', cursorToPrevWord);
  registerCommand(context, 'Extension.dltxt.cursorToSublineHead', () => {
		cursorToSublineHead();
	});

	registerCommand(context, 'Extension.dltxt.cursorToSublineEnd', () => {
		nextPuncInText(false);
	});
  
  registerCommand(context, 'Extension.dltxt.cursorToPrevBinarySearch', cursorToPrevBinarySearch);

  registerCommand(context, 'Extension.dltxt.cursorToNextBinarySearch', cursorToNextBinarySearch);

	registerCommand(context, 'Extension.dltxt.moveToNextLine', () => {
		moveToNextLine();
	});

	registerCommand(context, 'Extension.dltxt.moveToPrevLine', () => {
		moveToPrevLine();
	});

	registerCommand(context, 'Extension.dltxt.deleteUntilPunc', () => {
		nextPuncInText(true);
	});

	registerCommand(context, 'Extension.dltxt.deleteAllAfter', () => {
		deleteAllAfter();
	});

	registerCommand(context, 'Extension.dltxt.replaceAllKeywordsAtCurrentPosition', (arg) => {
		replaceAllKeywordsAtCurrentPosition();
	})

  registerCommand(context, 'Extension.dltxt.replaceAllInLine', (arg) => {
		replaceAllInLine(arg.old_text, arg.new_text, arg.line);
	})
	
	registerCommand(context, 'Extension.dltxt.translateCurrentLine', translateCurrentLine);
}

export function getTextDelimiter() {
  const config = vscode.workspace.getConfiguration("dltxt");
  const textDelimiterStr = config.get('core.z.textDelimiter') as string;
  try {
    const translatedSuffixRegex = new RegExp(textDelimiterStr, 'g');
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
function cursorToLineHead() {
  const editor = vscode.window.activeTextEditor;
  const [ok, curLine, g] = DocumentParser.getCurrentTranslationLine(editor);
  if (editor && ok && curLine && g) {
    let m = g.prefix.length + g.white.length;
    utils.setCursorAndScroll(editor, 0, m);
  }
}

function cursorToLineEnd() {
  const editor = vscode.window.activeTextEditor;
  const [ok, curLine, g] = DocumentParser.getCurrentTranslationLine(editor);
  if (editor && ok && curLine && g) {
    let m = g.prefix.length + g.white.length + g.text.length;
    utils.setCursorAndScroll(editor, 0, m);
  }
}

function cursorToNextLine(nested: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const config = vscode.workspace.getConfiguration("dltxt");
  if (nested && !!config.get('nestedLine.token')) {
    const c = editor.selection.start;
    const text = editor.document.getText(new vscode.Range(c, c.with(c.line, 10000)));
      
    const token = config.get('nestedLine.token') as string;
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRegex = new RegExp(`${escapedToken}[\\s　]*`);
    const match = tokenRegex.exec(text);
    if (match) {
      const dx = match.index + match[0].length;
      utils.setCursorAndScroll(editor, 0, c.character + dx);
      return;
    }
  }

  const [ok, nextLine, g] = DocumentParser.getNextTranslationLine(editor);
  if (editor?.selection?.active && ok && nextLine && g) {
    let m = g.prefix.length + g.white.length;
    utils.setCursorAndScroll(editor, nextLine.lineNumber - editor.selection.active.line, m);
  }
}

function getNewLineTokenMatches(text: string): RegExpMatchArray[] {
  const config = vscode.workspace.getConfiguration("dltxt");
  const token = config.get('nestedLine.token') as string;
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRegex = new RegExp(`${escapedToken}[\\s　]*`, "g");
  
  const matches = [];
  do {
    const match = tokenRegex.exec(text);
    if (match) {
      matches.push(match);
      tokenRegex.lastIndex = match.index + match[0].length;
    } else {
      break;
    }
  } while (true);

  return matches;
}

function cursorToPrevLine(nested: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const config = vscode.workspace.getConfiguration("dltxt");
  if (nested && !!config.get('nestedLine.token')) {
    const c = editor.selection.start;
    const [ok, line, groups] = DocumentParser.getCurrentTranslationLine(editor);
    if (!ok || !line || !groups) {
      return;
    }
    const base = groups?.prefix.length + groups?.white.length;
    const text = groups?.text.substring(0, c.character - base);
    
    const matches = getNewLineTokenMatches(text);

    if (matches.length > 1) {
      const match = matches[matches.length - 2];
      match.index && utils.setCursorAndScroll(editor, 0, base + match.index + match[0].length);
      return;
    } else if (matches.length === 1) {
      utils.setCursorAndScroll(editor, 0, base);
      return;
    }
  }
  const [ok, prevLine, g] = DocumentParser.getPrevTranslationLine(editor);
  if (editor?.selection?.active && ok && prevLine && g) {
    let m = g.prefix.length + g.white.length;
    utils.setCursorAndScroll(editor, prevLine.lineNumber - editor.selection.active.line, m);
  }
}

function cursorToNextWord() {
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
function cursorToPrevWord() {
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

const BinarySearchState = {
  step: 0,
  filename: "",
  lineNumber: -1,
  pos: -1
}

function cursorToNextBinarySearch() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.selection.isEmpty) {
    const c = editor.selection.active;
    const [curIsTranslation, curLine, curGroups] = DocumentParser.getCurrentTranslationLine(editor);
    if (!curIsTranslation || !curLine || !curGroups) {
      return;
    }
    const textStartIdx = curGroups.prefix.length + curGroups.white.length;
    let relativePos = c.character - textStartIdx;
    const textAfter = curGroups.text.substring(relativePos);
    const upperBound = textStartIdx + curGroups.text.length;
    
    const st = BinarySearchState;
    let step = 1;
    if (st.filename === editor.document.fileName && st.lineNumber === c.line && st.pos === c.character) {
      step = Math.max(1, Math.floor(st.step / 2));
    } else {
      step = Math.max(1, Math.floor(textAfter.length / 2));
    }
    const target = Math.min(c.character + step, upperBound);
    utils.setCursorAndScroll(editor, 0, target, false);
    st.filename = editor.document.fileName;
    st.lineNumber = c.line;
    st.step = step;
    st.pos = target;
  }
}

function cursorToPrevBinarySearch() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.selection.isEmpty) {
    const c = editor.selection.active;
    const [curIsTranslation, curLine, curGroups] = DocumentParser.getCurrentTranslationLine(editor);
    if (!curIsTranslation || !curLine || !curGroups) {
      return;
    }
    const textStartIdx = curGroups.prefix.length + curGroups.white.length;
    let relativePos = c.character - textStartIdx;
    const textBefore = curGroups.text.substring(0, relativePos);
    const lowerBound = textStartIdx;

    const st = BinarySearchState;
    let step = 1;
    if (st.filename === editor.document.fileName && st.lineNumber === c.line && st.pos === c.character) {
      step = Math.max(1, Math.floor(st.step / 2));
    } else {
      step = Math.max(1, Math.floor(textBefore.length / 2))
    }
    const target = Math.max(lowerBound, c.character - step, lowerBound);
    utils.setCursorAndScroll(editor, 0, target, false);
    st.filename = editor.document.fileName;
    st.lineNumber = c.line;
    st.step = step;
    st.pos = target;
  }
}

function moveToNextLine() {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;
  const [curIsTranslation] = DocumentParser.getCurrentTranslationLine(editor);
  if (!curIsTranslation) {
    return;
  }
  
  const config = vscode.workspace.getConfiguration("dltxt");
  if (!!config.get('nestedLine.token')) {
    const c = editor.selection.start;
    const text = editor.document.getText(new vscode.Range(c, c.with(c.line, 10000)));
      
    const token = config.get('nestedLine.token') as string;
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRegex = new RegExp(`${escapedToken}[\\s　]*`);
    const match = tokenRegex.exec(text);
    if (match) {
      const toEdit = new vscode.Range(
        c.with(c.line, c.character),
        c.with(c.line, c.character + match.index + match[0].length));
      const text = editor.document.getText(toEdit);
      const edited = text.substring(match.index) + text.substring(0, match.index);
      editor.edit((editbuilder) => {
        editbuilder.replace(toEdit, edited);
      });
      if (config.get('motion.moveToNextLine.moveCursor') as boolean) {
        utils.setCursorAndScroll(editor, 0, c.character + edited.length);
      }
    }
    return;
  }

  const [ok, nextLine, g] = DocumentParser.getNextTranslationLine(editor);
  if (!editor.selection?.active || !ok || !g || !nextLine) {
    return;
  }
  const position = editor.selection.active;
  let m = g.prefix.length + g.white.length;
  let n = nextLine.lineNumber - position.line;
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
  if (config.get('motion.moveToNextLine.moveCursor') as boolean) {
    utils.setCursorAndScroll(editor, n, m + sline.length);
  }
}

function moveToPrevLine() {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;

  const config = vscode.workspace.getConfiguration("dltxt");
  if (!!config.get('nestedLine.token')) {
    const [ok, curLine, g] = DocumentParser.getCurrentTranslationLine(editor);
    if (!ok || !curLine || !g) {
      return;
    }
    const c = editor.selection.start;
    const base = g.prefix.length + g.white.length;
    const text = g.text.substring(0, c.character - base);
      
    const matches = getNewLineTokenMatches(text);

    if (matches.length > 0) {
      const match = matches[matches.length - 1];
      if (!match.index) {
        return;
      }
      const toEdit = new vscode.Range(
        c.with(c.line, base + match.index),
        c.with(c.line, c.character));
      const text = editor.document.getText(toEdit);
      const edited = text.substring(match[0].length) + text.substring(0, match[0].length);
      editor.edit((editbuilder) => {
        editbuilder.replace(toEdit, edited);
      });
    }
    return;
  }

  const [ok, nextLine, g] = DocumentParser.getNextTranslationLine(editor);
  if (!editor.selection?.active || !ok || !g || !nextLine) {
    return;
  }

  const position = editor.selection.active;
  let m = g.prefix.length + g.white.length;
  let n = nextLine.lineNumber - position.line;
  const [ok2, curLine, curg] = DocumentParser.getCurrentTranslationLine(editor);
  if (!ok2 || !curLine || !curg) {
    return;
  }
  
  const t = curg.prefix.length + curg.white.length;
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

function nextPuncInText(del: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;
  const position = editor.selection.active;
  const [curIsTranslation, curLine, curGroups] = DocumentParser.getCurrentTranslationLine(editor);
  if (!curIsTranslation || !curLine || !curGroups) {
    return;
  }
  const textStartIdx = curGroups.prefix.length + curGroups.white.length;
  let iend = position.character - textStartIdx;
  const textAfter = curGroups.text.substring(iend);
  const delimMatch = getTextDelimiter().exec(textAfter)
  if (delimMatch) {
    iend += delimMatch.index === 0 ? 1 : delimMatch.index;
    curGroups.text.substring(iend - 1, 2) === "……" && iend++;
  } else {
    iend = curGroups.text.length;
  }

  if (del) {
    if (position.character < textStartIdx + iend) {
      const toDelete = new vscode.Range(
        position.with(position.line, position.character),
        position.with(position.line, textStartIdx + iend)
      );
      editor.edit((editbuilder) => {
        editbuilder.delete(toDelete);
      });
    }
  } else {
    const newPosition = position.with(position.line, textStartIdx + iend);
    editor.selection = new vscode.Selection(newPosition, newPosition);
  }
}

function deleteAllAfter() {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;
  const position = editor.selection.active;
  const [curIsTranslation, curLine, curGroups] = DocumentParser.getCurrentTranslationLine(editor);
  if (!curIsTranslation || !curLine || !curGroups) {
    return;
  }
  const iend = curGroups.prefix.length + curGroups.white.length + curGroups.text.length;
  editor.edit(builder => {
    const toDelete = new vscode.Range(
      position.with(position.line, position.character),
      position.with(position.line, iend));
    builder.delete(toDelete);
  })
}

function cursorToSublineHead() {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;

  const delimiterPattern = getTextDelimiter();
  const position = editor.selection.active;
  
  const [isCurTrans, curLine, groups] = DocumentParser.getCurrentTranslationLine(editor);
  if (!isCurTrans || !curLine || !groups) {
    return;
  }

  const prefixLen = groups.prefix.length + groups.white.length;

  const curChar = position.character;
  let textLeft = curLine.text.substring(0, curChar);
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

function replaceAllKeywordsAtCurrentPosition() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.selection) {
    return;
  }
  const position = editor.selection.active;
  const dictNames = DictSettings.getAllDictNames();
  const lookupTable = new Map<string, string | ((arg: string)=>string) >();
	for (const dictName of dictNames) {
    const decoID = `${editor.document.uri.fsPath}::${dictName}`;
    const decos = DecorationMemoryStorage.get(decoID);
    if(Array.isArray(decos)) {
      for(const d of decos) {
        const deco: vscode.DecorationOptions & { __dltxt: any } = d;
        if (deco.range.contains(position)) {
          lookupTable.set(deco.__dltxt.old_text, deco.__dltxt.new_text);
        }
      }
    }
  }
  if(lookupTable.size > 0) {
    translateCurrentLine(lookupTable, false, position.line);
  }
 
}

function replaceAllInLine(old_text: string, new_text: string, line: number) {
  const lookupTable = new Map<string, string | ((arg: string)=>string) >([
    [old_text, new_text],
  ]);
  translateCurrentLine(lookupTable, false, line);
}


const lineTranslateTable = new Map<RegExp, string | ((arg: string)=>string) >([
    [/[っ゛]/g, ''],
    [/だめ/g, '不行'],
    [/[れぺ][ろる]+/g, (s)=>'啾' + repeatStr('噜',s.length-1, false)],
    [/[ぴぷ]ち[ゃゅ]/g, '噗啾'],
    [/[ちじぢ]ゅ[ぷぶぽぼ]+/g, (s)=> '啾' + repeatStr('噗',s.length-2, false)],
    [/[ちじぢ]ゅ[うぅ]?/g, '啾'],
    [/りゅ/g, '噜'],
    [/[こご]くん/g, '咕噜'],
    [/ど?[びぴ]ゅる+[うぅ]*/g, (s)=>'咻' + repeatStr('噜',s.length-1, true)],
    [/ど?[びぴ]ゅ(く[うぅ]*)?/g, (s)=>repeatStr('咻',s.length, false)],
    [/ど[ぷく]+/g, (s)=>'咻' + repeatStr('噗',s.length-1, false)],
    [/や[あぁ]*/g, (s)=>'呀'+repeatStr('啊',s.length-1, true)],
    [/[あぁ]+/g, (s)=>repeatStr('啊',s.length, true)],
    [/[おぉ]+/g, (s)=>repeatStr('哦',s.length, false)],
    [/ず+/g, (s)=>repeatStr('滋',s.length, false)],
    [/ふ+/g, (s)=>repeatStr('呼',s.length, false)],
    [/ふう?/g, '呼'],
    [/う(?=あ)/g, '哇'],
    [/[うぅ]+/g, (s)=>repeatStr('呜',s.length, false)],
    [/[ひき][ゃぃ]?/g, '呀'],
    [/く/g, '咕'],
    [/ぐ/g, '咕'],
    [/ぬ/g, '呶'],
    [/ぱ[ん]?/g, '啪'],
    [/は[ん]?/g, '哈'],
    [/[ぷぶ][ん]?/g, '噗'],
    [/む[ん]?/g, '姆'],
    [/る/g, '噜'],
    [/ん+/g, (s)=>repeatStr('嗯',s.length, true)],
]);

export function translateCurrentLine(
  lookupTable:  Map<RegExp | string, string | ((arg: string)=>string) > = lineTranslateTable,
  kTohConversion: boolean = true,
  lineNum? : number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor)
    return;
  let [ok, curLine] = DocumentParser.getCurrentTranslationLine(editor, lineNum);
  if (!ok || !curLine) {
    return;
  }
  let replacedLine = curLine.text;
  if (kTohConversion) {
    replacedLine = utils.katakanaToHiragana(replacedLine);
  }
  for (const [k,v] of lookupTable) {
    if (typeof v == "string") {
      replacedLine = replacedLine.replace(k, v);
    } else {
      replacedLine = replacedLine.replace(k, v);
    }
  }
  editor.edit((editbuilder) => {
    if (curLine) {
      editbuilder.replace(curLine.range, replacedLine);
    }
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