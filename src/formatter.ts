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

  DocumentParser.processPairedLines(document, (jgrps, cgrps, j_index, c_index, talkingName) => {
    const line = document.lineAt(j_index);
    const nextLine = document.lineAt(c_index);
    let nextLineText = nextLine.text;

    for (let op of ops) {
      op(jgrps, cgrps);
    }

    if (debugMode) {
      const curLineText = `${jgrps?.prefix}{${talkingName}}{${jgrps?.white}}{${jgrps?.text}}{${jgrps?.suffix}}`
      result.push(vscode.TextEdit.replace(line.range, curLineText));
      nextLineText = `${cgrps?.prefix}{${talkingName}}{${cgrps?.white}}{${cgrps?.text}}{${cgrps?.suffix}}`
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

  const fixExcliamationQuestion = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    cgrps.text = cgrps.text.replace(/！+？/g, (s) => {
      const m = s.match(/！+/g);
      return m ? '？' + '！'.repeat(m[0].length) : s;
    });
  }
  if (config.get("formatter.a.fixExcliamationQuestion"))
    ops.push(fixExcliamationQuestion);

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


  const nestedLineToken = config.get("nestedLine.token") as string;
  const addSpaceAfterQE = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    let texts = cgrps.text.split(nestedLineToken);
    texts = texts.map(text => {
      return text.replace(/([？！])([ 　]*)/g, '$1').replace(/([？！])(?![？！—。，、「」『』（）【】]|$)/g, '$1　');
    });
    cgrps.text = texts.join(nestedLineToken);
  }
  const removeSpaceAfterQE = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    cgrps.text = cgrps.text.replace(/([？！])([ 　]*)/g, '$1');
  };
  const spaceAfterQEOption = config.get("formatter.c.addSpaceAfterQE")
  if (spaceAfterQEOption == '添加空格')
    ops.push(addSpaceAfterQE);
  else if (spaceAfterQEOption == '删除空格')
    ops.push(removeSpaceAfterQE);


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

const alphaNumPattern = /[A-Za-z0-9]/;
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
      while (i < textLeft.length && alphaNumPattern.test(textLeft[i])) {
        i++;
      }
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

export async function configureFormat() {
   const config = vscode.workspace.getConfiguration("dltxt");
   const choices = [
    {
      label: '统一省略号',
      configKey: 'formatter.a.ellipsis.enable',
    },
    {
      label: '统一破折号',
      configKey: 'formatter.a.horizontalLine.enable',
    },
    {
      label: '统一波浪号',
      configKey: 'formatter.a.wave.enable',
    },
    {
      label: '统一写反的、或半角的单引号、双引号',
      configKey: 'formatter.b.fixReversedQuote',
    },
    {
      label: '统一双引号',
      configKey: 'formatter.b.formatQuote.enable',
      specifyKey: 'formatter.b.formatQuote.specify',
      specifyOptions: ["“中文双引号”", "『日语双引号』"]
    },
    {
      label: '将？！替换为！？',
      configKey: 'formatter.a.fixExcliamationQuestion',
    },
    {
      label: '统一缩进与对话外的单括号（「」）',
      configKey: 'formatter.a.padding',
    },
    {
      label: '半角标点符号统一为全角（半角引号除外）',
      configKey: 'formatter.b.h2fPunc',
    },
    {
      label: '去除对话句末的句号',
      configKey: 'formatter.c.omitPeriod',
    },
    {
      label: '把……。改成……',
      configKey: 'formatter.c.removeEllipsisPeriod',
    },
    {
      label: '把……？/……！改成？/！',
      configKey: 'formatter.c.removeEllipsisQE',
    },
   ];
   const items: (vscode.QuickPickItem & { configKey: string, specifyKey?: string, specifyOptions?: string[] })[] = choices.map(choice => {
    return {
      label: choice.label,
      configKey: choice.configKey,
      picked: config.get(choice.configKey) as boolean,
    };
   });
   let res = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: '选择需要应用的格式化选项（可多选）'
   });
    if (!res) {
      return;
    }

    const prevSelected = new Set<string>();
    for (let item of items) {
      if (item.picked) {
        prevSelected.add(item.configKey);
      }
    }

    for (let item of res) {
      if (!prevSelected.has(item.configKey)) {
        await config.update(item.configKey, true, vscode.ConfigurationTarget.Workspace);
        if (item.specifyKey) {
          const specifyOption = await vscode.window.showQuickPick(item.specifyOptions || [], {
            placeHolder: `"${item.label}"`
          });
          if (specifyOption) {
            await config.update(item.specifyKey, specifyOption, vscode.ConfigurationTarget.Workspace);
          }
        }
      }
    }
    for (let item of items) {
      if (item.picked && !res.find(r => r.configKey === item.configKey)) {
        await config.update(item.configKey, false, vscode.ConfigurationTarget.Workspace);
      }
    }

    let addSpaceAfterQEOption = config.get("formatter.c.addSpaceAfterQE") as string;
    const chosenSpaceAfterQE = await vscode.window.showQuickPick(
      ['无效', '添加空格', '删除空格'],
      {
        placeHolder: '在问号、感叹号后添加空格'
      }
    );
    if (addSpaceAfterQEOption !== chosenSpaceAfterQE) {
      await config.update("formatter.c.addSpaceAfterQE", chosenSpaceAfterQE, vscode.ConfigurationTarget.Workspace);
    }
    vscode.window.showInformationMessage('格式化选项已更新');
  }