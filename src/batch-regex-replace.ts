import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DocumentParser } from './parser';
import { getCurrentWorkspaceFolder, registerCommand } from './utils';

const VIEW_TYPE = 'dltxt-batch-regex-replace';
const PANEL_TITLE = '译文替换流水线';
const TEXT_FILE_EXTENSIONS = new Set(['.txt']);

type ReplaceRuleType = 'standard' | 'naming-conditional';

interface ReplaceRuleInput {
  id?: string;
  type?: ReplaceRuleType;
  speaker?: string;
  pattern: string;
  replacement: string;
  regexEnabled: boolean;
  enabled?: boolean;
}

type CompiledRule = {
  id: string;
  type: ReplaceRuleType;
  speaker?: string;
  pattern: string;
  replacement: string;
  regex: RegExp;
  countRegex: RegExp;
  regexEnabled: boolean;
  enabled: boolean;
}

interface ReplaceTextResult {
  text: string;
  replacementCount: number;
}

interface DocumentTransformResult {
  text: string;
  changedLineCount: number;
  replacementCount: number;
}

interface QueuedDocumentChange {
  changedLineCount: number;
  replacementCount: number;
}

interface FileTreeNode {
  kind: 'folder' | 'file';
  name: string;
  path: string;
  relativePath: string;
  fileCount: number;
  children?: FileTreeNode[];
}

interface InitialStatePayload {
  rootPath: string;
  tree: FileTreeNode;
  initialSelectedFile?: string;
}

type WebviewMessage =
  | {
      type: 'previewFile';
      requestId: string;
      filePath: string;
      rules: ReplaceRuleInput[];
    }
  | {
      type: 'applyTarget';
      requestId: string;
      targetPath: string;
      targetKind: 'folder' | 'file';
      rules: ReplaceRuleInput[];
    }
  | {
      type: 'refreshTree';
      requestId: string;
      rootPath: string;
    }
  | {
      type: 'exportRulesJson';
      requestId: string;
      rules: ReplaceRuleInput[];
  };

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  registerCommand(context, 'Extension.dltxt.batchRegexReplaceTranslations', async (arg?: unknown) => {
    const rootPath = resolveRootPath(arg);
    if (!rootPath) {
      vscode.window.showErrorMessage('当前没有可用目录。请先打开工作区，或在一个本地文件上执行该命令。');
      return;
    }

    if (currentPanel) {
      currentPanel.dispose();
    }

    const panel = createPanel(context);
    currentPanel = panel;
    panel.title = `${PANEL_TITLE} - ${path.basename(rootPath)}`;
    panel.reveal(vscode.ViewColumn.Active);
    await renderPanel(panel, context, rootPath);
  });
}

function createPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    PANEL_TITLE,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview'),
        vscode.Uri.joinPath(context.extensionUri, 'media', 'webview')
      ]
    }
  );

  panel.onDidDispose(() => {
    if (currentPanel === panel) {
      currentPanel = undefined;
    }
  });

  return panel;
}

async function renderPanel(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, rootPath: string) {
  const initialState = createInitialState(rootPath);
  panel.webview.html = getBatchRegexReplaceHtml(panel.webview, context, initialState);
  panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
    await handleWebviewMessage(panel, rootPath, message);
  });
}

async function handleWebviewMessage(panel: vscode.WebviewPanel, fallbackRootPath: string, message: WebviewMessage) {
  try {
    if (message.type === 'previewFile') {
      const rules = compileRules(message.rules);
      const preview = await createPreview(message.filePath, rules);
      await panel.webview.postMessage({
        type: 'previewResult',
        requestId: message.requestId,
        payload: preview
      });
      return;
    }

    if (message.type === 'applyTarget') {
      const rules = compileRules(message.rules);
      const result = await applyToTarget(message.targetPath, message.targetKind, rules);
      await panel.webview.postMessage({
        type: 'applyResult',
        requestId: message.requestId,
        payload: result
      });
      return;
    }

    if (message.type === 'exportRulesJson') {
      const jsonContent = JSON.stringify(message.rules, null, 2);
      const uri = await vscode.window.showSaveDialog({
        title: '导出替换规则为 JSON 文件',
        defaultUri: vscode.Uri.file(path.join(fallbackRootPath, '批量替换规则.json')),
        filters: { 'JSON 文件': ['json'] }
      });
      let saved = false;
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(jsonContent, 'utf-8'));
        vscode.window.showInformationMessage('替换规则已成功导出。');
        saved = true;
      }
      await panel.webview.postMessage({
        type: 'exportRulesJsonResult',
        requestId: message.requestId,
        payload: { saved }
      });
      return;
    }

    const rootPath = message.rootPath || fallbackRootPath;
    const tree = createInitialState(rootPath);
    await panel.webview.postMessage({
      type: 'treeResult',
      requestId: message.requestId,
      payload: tree
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: 'requestError',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function createInitialState(rootPath: string): InitialStatePayload {
  const tree = buildFolderTree(rootPath, rootPath) ?? {
    kind: 'folder' as const,
    name: path.basename(rootPath),
    path: rootPath,
    relativePath: '.',
    fileCount: 0,
    children: []
  };

  return {
    rootPath,
    tree,
    initialSelectedFile: findFirstFile(tree)
  };
}

function resolveRootPath(target: unknown): string | undefined {
  const workspaceFolder = getCurrentWorkspaceFolder();
  if (workspaceFolder) {
    return workspaceFolder;
  }

  const uri = toUri(target);
  if (uri && uri.scheme === 'file' && fs.existsSync(uri.fsPath)) {
    const stat = fs.statSync(uri.fsPath);
    return stat.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
  }

  const activeEditorPath = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorPath?.scheme === 'file' && fs.existsSync(activeEditorPath.fsPath)) {
    return path.dirname(activeEditorPath.fsPath);
  }

  return undefined;
}

function toUri(target: unknown): vscode.Uri | undefined {
  if (target instanceof vscode.Uri) {
    return target;
  }
  if (target && typeof target === 'object') {
    const possibleUri = target as { fsPath?: string; path?: string };
    if (typeof possibleUri.fsPath === 'string') {
      return vscode.Uri.file(possibleUri.fsPath);
    }
    if (typeof possibleUri.path === 'string' && possibleUri.path.length > 0) {
      return vscode.Uri.file(possibleUri.path);
    }
  }
  return undefined;
}

function buildFolderTree(folderPath: string, rootPath: string): FileTreeNode | undefined {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const children: FileTreeNode[] = [];
  let fileCount = 0;
  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      const child = buildFolderTree(fullPath, rootPath);
      if (child && child.fileCount > 0) {
        children.push(child);
        fileCount += child.fileCount;
      }
      continue;
    }

    if (!entry.isFile() || !isTextFile(entry.name)) {
      continue;
    }

    fileCount++;
    children.push({
      kind: 'file',
      name: entry.name,
      path: fullPath,
      relativePath: toRelativePath(rootPath, fullPath),
      fileCount: 1
    });
  }

  children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'folder' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-Hans-CN');
  });

  return {
    kind: 'folder',
    name: path.basename(folderPath),
    path: folderPath,
    relativePath: folderPath === rootPath ? '.' : toRelativePath(rootPath, folderPath),
    fileCount,
    children
  };
}

function toRelativePath(rootPath: string, targetPath: string): string {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath.length > 0 ? relativePath : '.';
}

function findFirstFile(node: FileTreeNode): string | undefined {
  if (node.kind === 'file') {
    return node.path;
  }
  for (const child of node.children ?? []) {
    const filePath = findFirstFile(child);
    if (filePath) {
      return filePath;
    }
  }
  return undefined;
}

function isTextFile(fileName: string): boolean {
  const extension = path.extname(fileName).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(extension);
}

function escapeRegExp(string: string): string {
  // $& 表示匹配到的整个字符
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRuleType(value: ReplaceRuleInput['type']): ReplaceRuleType {
  return value === 'naming-conditional' ? 'naming-conditional' : 'standard';
}

function normalizeSpeakerName(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : undefined;
}

function doesRuleMatchSpeaker(rule: CompiledRule, talkingName?: string): boolean {
  if (!rule.enabled) {
    return false;
  }

  if (rule.type !== 'naming-conditional') {
    return true;
  }

  const currentSpeaker = normalizeSpeakerName(talkingName);
  return !!rule.speaker && currentSpeaker === rule.speaker;
}

function compileRules(rules: ReplaceRuleInput[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    const pattern = rule.pattern?.trim() ?? '';
    const enabled = rule.enabled !== false;
    if (!pattern || !enabled) {
      continue;
    }

    const type = normalizeRuleType(rule.type);
    const speaker = normalizeSpeakerName(rule.speaker);
    if (type === 'naming-conditional' && !speaker) {
      continue;
    }

    const id = rule.id || `rule-${index + 1}`;
    const replacement = decodeReplacementEscapes(rule.replacement ?? '');
    const regexEnabled = Boolean(rule.regexEnabled);
    try {
      // 如果没有启用正则，就对 pattern 进行转义
      const finalPattern = regexEnabled ? pattern : escapeRegExp(pattern);

      compiled.push({
        id,
        type,
        speaker,
        pattern, // 保持用户看到的原始文本不变
        replacement,
        regex: new RegExp(finalPattern, 'g'),
        countRegex: new RegExp(finalPattern, 'g'),
        regexEnabled,
        enabled
      });
    } catch (error) {
      throw new Error(`第 ${index + 1} 条规则的正则无效: ${String(error)}`);
    }
  }
  return compiled;
}

function decodeReplacementEscapes(value: string): string {
  return value.replace(/\\([nrt\\])/g, (_match, code: string) => {
    if (code === 'n') {
      return '\n';
    }
    if (code === 'r') {
      return '\r';
    }
    if (code === 't') {
      return '\t';
    }
    return '\\';
  });
}

function applyRulesToText(text: string, rules: CompiledRule[], talkingName?: string): ReplaceTextResult {
  let current = text;
  let replacementCount = 0;

  for (const rule of rules) {
    if (!doesRuleMatchSpeaker(rule, talkingName)) {
      continue;
    }

    const matchCount = countMatches(current, rule.countRegex);
    if (matchCount === 0) {
      continue;
    }
    current = current.replace(rule.regex, rule.replacement);
    replacementCount += matchCount;
  }

  return { text: current, replacementCount };
}

function countMatches(text: string, regex: RegExp): number {
  regex.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    count++;
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }
  return count;
}

function transformDocument(doc: vscode.TextDocument, rules: CompiledRule[]): DocumentTransformResult {
  const lines = Array.from({ length: doc.lineCount }, (_, index) => doc.lineAt(index).text);
  let changedLineCount = 0;
  let replacementCount = 0;

  DocumentParser.processPairedLines(doc, (_jGroups, groups, _jLineIndex, lineIndex, talkingName) => {
    const lineText = lines[lineIndex];
    const editableStart = groups.prefix.length;
    const originalEditable = lineText.slice(editableStart);
    const transformed = applyRulesToText(originalEditable, rules, talkingName);
    if (transformed.text === originalEditable) {
      return;
    }

    lines[lineIndex] = `${lineText.slice(0, editableStart)}${transformed.text}`;
    changedLineCount++;
    replacementCount += transformed.replacementCount;
  });

  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  return {
    text: lines.join(eol),
    changedLineCount,
    replacementCount
  };
}

function queueDocumentEdits(doc: vscode.TextDocument, rules: CompiledRule[], edit: vscode.WorkspaceEdit): QueuedDocumentChange {
  let changedLineCount = 0;
  let replacementCount = 0;

  DocumentParser.processPairedLines(doc, (_jGroups, groups, _jLineIndex, lineIndex, talkingName) => {
    const line = doc.lineAt(lineIndex);
    const editableStart = groups.prefix.length;
    const originalEditable = line.text.slice(editableStart);
    const transformed = applyRulesToText(originalEditable, rules, talkingName);
    if (transformed.text === originalEditable) {
      return;
    }

    const startCharacter = editableStart;
    const endCharacter = line.range.end.character;
    edit.replace(
      doc.uri,
      new vscode.Range(line.range.start.with({ character: startCharacter }), line.range.start.with({ character: endCharacter })),
      transformed.text
    );

    changedLineCount++;
    replacementCount += transformed.replacementCount;
  });

  return { changedLineCount, replacementCount };
}

async function createPreview(filePath: string, rules: CompiledRule[]) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  const transformed = transformDocument(doc, rules);
  return {
    filePath,
    fileName: path.basename(filePath),
    beforeText: doc.getText(),
    afterText: transformed.text,
    changedLineCount: transformed.changedLineCount,
    replacementCount: transformed.replacementCount,
    hasChanges: transformed.changedLineCount > 0
  };
}

async function applyToTarget(targetPath: string, targetKind: 'folder' | 'file', rules: CompiledRule[]) {
  const filePaths = targetKind === 'file' ? [targetPath] : collectFiles(targetPath);
  if (filePaths.length === 0) {
    return {
      targetPath,
      targetKind,
      fileCount: 0,
      changedFileCount: 0,
      changedLineCount: 0,
      replacementCount: 0,
      savedFileCount: 0,
      unsavedFileCount: 0
    };
  }

  const edit = new vscode.WorkspaceEdit();
  const changedDocs: Array<{ doc: vscode.TextDocument; wasDirtyBefore: boolean }> = [];
  let changedFileCount = 0;
  let changedLineCount = 0;
  let replacementCount = 0;

  for (const filePath of filePaths) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const queued = queueDocumentEdits(doc, rules, edit);
    if (queued.changedLineCount === 0) {
      continue;
    }

    changedDocs.push({ doc, wasDirtyBefore: doc.isDirty });
    changedFileCount++;
    changedLineCount += queued.changedLineCount;
    replacementCount += queued.replacementCount;
  }

  if (changedDocs.length === 0) {
    return {
      targetPath,
      targetKind,
      fileCount: filePaths.length,
      changedFileCount: 0,
      changedLineCount: 0,
      replacementCount: 0,
      savedFileCount: 0,
      unsavedFileCount: 0
    };
  }

  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    throw new Error('应用替换失败。');
  }

  let savedFileCount = 0;
  let unsavedFileCount = 0;
  for (const item of changedDocs) {
    if (item.wasDirtyBefore) {
      unsavedFileCount++;
      continue;
    }
    const saved = await item.doc.save();
    if (saved) {
      savedFileCount++;
    } else {
      unsavedFileCount++;
    }
  }

  return {
    targetPath,
    targetKind,
    fileCount: filePaths.length,
    changedFileCount,
    changedLineCount,
    replacementCount,
    savedFileCount,
    unsavedFileCount
  };
}

function collectFiles(folderPath: string): string[] {
  const result: string[] = [];
  const stack: string[] = [folderPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && isTextFile(entry.name)) {
        result.push(fullPath);
      }
    }
  }
  result.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
  return result;
}

function getBatchRegexReplaceHtml(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  initialState: InitialStatePayload
): string {
  const sharedScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'react-shared-vendor.js'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'batch-regex-replace.js'));
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'batch-regex-replace.css'));
  const initialJson = JSON.stringify(initialState).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="view-root"></div>
  <script id="initial-state" type="application/json">${initialJson}</script>
  <script src="${sharedScriptUri}"></script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}