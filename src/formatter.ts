import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { repeatStr, toAscii, toDBC } from './utils';
import { getTextDelimiter } from './motion';
import { findLastMatchIndex } from './utils';
import { DocumentParser, MatchedGroups, getRegex } from './parser';
import { ContextHolder } from './utils';
import { Position, Range, Selection } from 'vscode';
import { getChineseTokenizer } from './tokenizer';



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
      const cuttedText = getChineseTokenizer().cut(cgrps?.text ?? '', true).join('/');
      nextLineText = `${cgrps?.prefix}{${talkingName}}{${cgrps?.white}}{${cuttedText}}{${cgrps?.suffix}} talking:[${talkingName}]`;
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

function getStandardFormatSpec(): Array<CallableFunction> {
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
  const escapedNestedLineToken = nestedLineToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  const createSpaceAfterNewlineOp = (option: string, jgrpsWhite: string) => (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    return formatNewlineInLine(option, escapedNestedLineToken, jgrps, cgrps);
  };
  const spaceAfterNewlineOption = config.get("formatter.c.addSpaceAfterNewline")
  if (spaceAfterNewlineOption == '添加空格' || spaceAfterNewlineOption == '删除空格') {
    ops.push((jgrps: MatchedGroups, cgrps: MatchedGroups) => createSpaceAfterNewlineOp(spaceAfterNewlineOption as string, jgrps.white)(jgrps, cgrps));
  }



  const customMappingFunc = (jgrps: MatchedGroups, cgrps: MatchedGroups) => {
    const nameMapping = config.get("formatter.d.customMapping") as object
    if (cgrps?.text) {
      for (const [key, value] of Object.entries(nameMapping)) {
        cgrps.text = cgrps.text.replace(new RegExp(`${key}`, 'g'), value);
      }
    }
  }
  ops.push(customMappingFunc);
  return ops;
}

export function formatter(context: vscode.ExtensionContext, document: vscode.TextDocument): vscode.TextEdit[] {
  const ops = getStandardFormatSpec();
  return editTranslation(context, document, ops);
}

export function formatNewlineInLine(option: string, escapedNestedLineToken: string, jgrps: MatchedGroups, cgrps: MatchedGroups) {
  let text = cgrps.text as string;
  if (option === '删除空格' || !/([「『（])/.test(jgrps.white)) {
    cgrps.text = text.replace(new RegExp(`(${escapedNestedLineToken})[ 　]+`, 'g'), `$1`);
  } else {
    cgrps.text = text.replace(new RegExp(`(${escapedNestedLineToken})(?![ 　])`, 'g'), `$1　`);
  }
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
  const delimiterPattern = getTextDelimiter('[A-Za-z0-9]');

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

async function updateSpaceConfigOption(config: vscode.WorkspaceConfiguration, configKey: string, placeHolder: string): Promise<void> {
  const currentOption = config.get(configKey) as string;
  const chosenOption = await vscode.window.showQuickPick(
    ['无效', '添加空格', '删除空格'],
    { placeHolder }
  );
  if (currentOption !== chosenOption) {
    await config.update(configKey, chosenOption, vscode.ConfigurationTarget.Workspace);
  }
}

interface FormatChoice {
  label: string;
  configKey: string;
  specifyKey?: string;
  specifyOptions?: string[];
}

interface FormatChoiceState extends FormatChoice {
  enabled: boolean;
  specifiedValue?: string;
}

interface FormatConfigWebviewState {
  choices: FormatChoiceState[];
  newlineToken: string;
  newlineMaxLen: number;
  spaceAfterQE: string;
  spaceAfterNewline: string;
}

interface FormatConfigSubmitPayload {
  choices: Array<{ configKey: string; enabled: boolean; specifyKey?: string; specifyValue?: string }>;
  newlineToken: string;
  newlineMaxLen: number;
  spaceAfterQE: string;
  spaceAfterNewline: string;
}

function getFormatChoices(): FormatChoice[] {
  return [
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
      specifyOptions: ['“中文双引号”', '『日语双引号』']
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
}

function buildFormatConfigState(config: vscode.WorkspaceConfiguration): FormatConfigWebviewState {
  const choices = getFormatChoices().map(choice => ({
    ...choice,
    enabled: config.get(choice.configKey) as boolean,
    specifiedValue: choice.specifyKey ? config.get(choice.specifyKey) as string : undefined,
  }));

  return {
    choices,
    newlineToken: (config.get('nestedLine.token') as string) || '',
    newlineMaxLen: (config.get('nestedLine.maxLen') as number) || 24,
    spaceAfterQE: (config.get('formatter.c.addSpaceAfterQE') as string) || '无效',
    spaceAfterNewline: (config.get('formatter.c.addSpaceAfterNewline') as string) || '无效',
  };
}

function getConfigureFormatWebviewHtml(panel: vscode.WebviewPanel, state: FormatConfigWebviewState): string {
  const extensionUri = ContextHolder.get().extensionUri;
  const htmlPath = path.join(ContextHolder.get().extensionPath, 'src', 'webview', 'format-config.html');
  const template = fs.readFileSync(htmlPath, 'utf8');
  const cssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'format-config.css'));
  const sharedScriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'react-shared-vendor.js'));
  const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'format-config.js'));
  const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');

  return template
    .replace('{{styleUri}}', cssUri.toString())
    .replace('{{sharedScriptUri}}', sharedScriptUri.toString())
    .replace('{{scriptUri}}', scriptUri.toString())
    .replace('{{state}}', serializedState);
}

export async function configureFormat() {
  const config = vscode.workspace.getConfiguration('dltxt');
  const panel = vscode.window.createWebviewPanel(
    'dltxt-format-config',
    '设置文本格式规范',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
    }
  );

  panel.webview.html = getConfigureFormatWebviewHtml(panel, buildFormatConfigState(config));

  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      messageDisposable.dispose();
      closeDisposable.dispose();
      resolve();
    };

    const messageDisposable = panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'config-cancel') {
        panel.dispose();
        finish();
        return;
      }

      if (message?.type !== 'config-submit' || !message.payload) {
        return;
      }

      const payload = message.payload as FormatConfigSubmitPayload;

      if (!payload.newlineToken) {
        vscode.window.showErrorMessage('换行符不能为空');
        return;
      }

      if (!Number.isInteger(payload.newlineMaxLen) || payload.newlineMaxLen <= 0) {
        vscode.window.showErrorMessage('单行最大长度必须是正整数');
        return;
      }

      for (const choice of payload.choices) {
        await config.update(choice.configKey, choice.enabled, vscode.ConfigurationTarget.Workspace);
        if (choice.specifyKey && choice.specifyValue) {
          await config.update(choice.specifyKey, choice.specifyValue, vscode.ConfigurationTarget.Workspace);
        }
      }

      await config.update('nestedLine.token', payload.newlineToken, vscode.ConfigurationTarget.Workspace);
      await config.update('nestedLine.maxLen', payload.newlineMaxLen, vscode.ConfigurationTarget.Workspace);
      await config.update('formatter.c.addSpaceAfterQE', payload.spaceAfterQE, vscode.ConfigurationTarget.Workspace);
      await config.update('formatter.c.addSpaceAfterNewline', payload.spaceAfterNewline, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage('格式化选项已更新');
      panel.dispose();
      finish();
    });

    const closeDisposable = panel.onDidDispose(() => {
      finish();
    });
  });
}