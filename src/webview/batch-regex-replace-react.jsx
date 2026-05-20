import { React, createRoot, useEffect, useRef, useState } from './react-shared-runtime';

const vscode = acquireVsCodeApi();
const initialStateElement = document.getElementById('initial-state');
const initialState = initialStateElement ? JSON.parse(initialStateElement.textContent || '{}') : {};

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createRule() {
  return {
    id: uid('rule'),
    pattern: '',
    replacement: ''
  };
}

function basename(filePath) {
  return (filePath || '').split(/[/\\]/).pop() || filePath || '';
}

function serializeRules(rules) {
  return rules.map((rule) => ({
    id: rule.id,
    pattern: rule.pattern,
    replacement: rule.replacement
  }));
}

function findNodeByPath(node, targetPath) {
  if (!node || !targetPath) {
    return undefined;
  }
  if (node.path === targetPath) {
    return node;
  }
  for (const child of node.children || []) {
    const result = findNodeByPath(child, targetPath);
    if (result) {
      return result;
    }
  }
  return undefined;
}

function splitLines(text) {
  return text.length === 0 ? [''] : text.split(/\r?\n/);
}

function computeDiffRows(beforeText, afterText) {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  if (beforeLines.length * afterLines.length <= 160000) {
    return computeLcsDiff(beforeLines, afterLines);
  }

  const rows = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index++) {
    const before = beforeLines[index];
    const after = afterLines[index];
    let kind = 'equal';
    if (before === undefined) {
      kind = 'added';
    } else if (after === undefined) {
      kind = 'removed';
    } else if (before !== after) {
      kind = 'changed';
    }
    rows.push({
      kind,
      beforeLineNumber: before === undefined ? '' : String(index + 1),
      afterLineNumber: after === undefined ? '' : String(index + 1),
      beforeText: before || '',
      afterText: after || ''
    });
  }
  return rows;
}

function computeLcsDiff(beforeLines, afterLines) {
  const rows = [];
  const m = beforeLines.length;
  const n = afterLines.length;

  // 1. 空间优化：动态选择较短的数组作为滚动列，维持空间在 O(min(M, N))
  // 为了不破坏你后续从 0 到 m/n 的正向回溯逻辑，我们这里依然维持空间为 (n + 1)
  // 仅用两行（当前行、下一行）进行滚动计算
  let nextRow = new Array(n + 1).fill(0);
  let currRow = new Array(n + 1).fill(0);

  // 2. 引入轻量级的“决策状态矩阵”（用 0, 1, 2, 3 存储轻量状态，占用内存极小）
  // 0: equal, 1: changed, 2: removed, 3: added
  const hints = Array.from({ length: m }, () => new Uint8Array(n));

  // 逆向滚动计算
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (beforeLines[i] === afterLines[j]) {
        currRow[j] = nextRow[j + 1] + 1;
        hints[i][j] = 0; // equal
      } else {
        const scoreMovedI = nextRow[j];     // matrix[i + 1][j]
        const scoreMovedJ = currRow[j + 1]; // matrix[i][j + 1]

        if (scoreMovedI === scoreMovedJ) {
          currRow[j] = scoreMovedI;
          hints[i][j] = 1; // changed
        } else if (scoreMovedI > scoreMovedJ) {
          currRow[j] = scoreMovedI;
          hints[i][j] = 2; // removed
        } else {
          currRow[j] = scoreMovedJ;
          hints[i][j] = 3; // added
        }
      }
    }
    // 滚动：将当前行的数据拷贝或引用切换给下一行
    // 优雅的分配：复用已有的数组空间，避免重复垃圾回收（GC）
    const temp = nextRow;
    nextRow = currRow;
    currRow = temp;
    currRow.fill(0); // 清空以便下一次循环使用
  }

  // 3. 正向回溯：完全不需要读取海量的得分矩阵，直接根据 hints 决策图进行快车道回溯
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    const hint = hints[i][j];

    if (hint === 0) { // equal
      rows.push({
        kind: 'equal',
        beforeLineNumber: String(i + 1),
        afterLineNumber: String(j + 1),
        beforeText: beforeLines[i],
        afterText: afterLines[j]
      });
      i++;
      j++;
    } else if (hint === 1) { // changed
      rows.push({
        kind: 'changed',
        beforeLineNumber: String(i + 1),
        afterLineNumber: String(j + 1),
        beforeText: beforeLines[i],
        afterText: afterLines[j]
      });
      i++;
      j++;
    } else if (hint === 2) { // removed
      rows.push({
        kind: 'removed',
        beforeLineNumber: String(i + 1),
        afterLineNumber: '',
        beforeText: beforeLines[i],
        afterText: ''
      });
      i++;
    } else { // added
      rows.push({
        kind: 'added',
        beforeLineNumber: '',
        afterLineNumber: String(j + 1),
        beforeText: '',
        afterText: afterLines[j]
      });
      j++;
    }
  }

  // 4. 收尾剩余行
  while (i < m) {
    rows.push({
      kind: 'removed',
      beforeLineNumber: String(i + 1),
      afterLineNumber: '',
      beforeText: beforeLines[i],
      afterText: ''
    });
    i++;
  }

  while (j < n) {
    rows.push({
      kind: 'added',
      beforeLineNumber: '',
      afterLineNumber: String(j + 1),
      beforeText: '',
      afterText: afterLines[j]
    });
    j++;
  }

  return rows;
}
function RuleCard({
  rule,
  index,
  total,
  onChange,
  onMove,
  onRemove,
  onCompositionStart,
  onCompositionEnd
}) {
  return (
    <section className="rule-card">
      <div className="rule-card-header">
        <div className="rule-index">规则 {index + 1}</div>
        <div className="rule-actions">
          <button
            className="ghost icon-button"
            disabled={index === 0}
            onClick={() => onMove(rule.id, 'up')}
          >
            ↑
          </button>
          <button
            className="ghost icon-button"
            disabled={index === total - 1}
            onClick={() => onMove(rule.id, 'down')}
          >
            ↓
          </button>
          <button className="ghost danger icon-button" onClick={() => onRemove(rule.id)}>
            ×
          </button>
        </div>
      </div>
      <label className="field-label">
        <span>正则表达式</span>
        <input
          type="text"
          placeholder="例如：(\\w+)_old"
          value={rule.pattern}
          onChange={(event) => onChange(rule.id, 'pattern', event.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(event) => onCompositionEnd(rule.id, 'pattern', event.currentTarget.value)}
        />
      </label>
      <label className="field-label">
        <span>替换内容</span>
        <input
          type="text"
          placeholder="支持 $1、$2，以及 \\n / \\t 等转义"
          value={rule.replacement}
          onChange={(event) => onChange(rule.id, 'replacement', event.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(event) => onCompositionEnd(rule.id, 'replacement', event.currentTarget.value)}
        />
      </label>
    </section>
  );
}

function TreeNode({ node, selectedFile, expandedFolders, onToggleFolder, onSelectFile, onApplyTarget }) {
  const isActive = node.kind === 'file' && node.path === selectedFile;
  const isExpanded = node.kind === 'folder' && expandedFolders.has(node.path);
  const icon = node.kind === 'folder' ? '📁' : '📄';
  const actionLabel = node.kind === 'folder' ? '替换目录' : '替换';
  const meta = node.kind === 'folder' ? `${node.fileCount} 个文本文件` : node.relativePath;

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${isActive ? 'active' : ''}`}
        onClick={() => {
          if (node.kind === 'file') {
            void onSelectFile(node.path);
          }
        }}
      >
        <div className="tree-node-main">
          {node.kind === 'folder' ? (
            <button
              className="ghost icon-button folder-toggle"
              onClick={(event) => {
                event.stopPropagation();
                onToggleFolder(node.path);
              }}
            >
              {isExpanded ? 'V' : '>'}
            </button>
          ) : null}
          <div>{icon}</div>
          <div className="tree-label">
            <div className="tree-name">{node.name}</div>
            <div className="tree-path">{meta}</div>
          </div>
        </div>
        <button
          className="ghost"
          onClick={(event) => {
            event.stopPropagation();
            void onApplyTarget(node.path, node.kind);
          }}
        >
          {actionLabel}
        </button>
      </div>
      {node.kind === 'folder' && isExpanded && node.children && node.children.length > 0 ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedFile={selectedFile}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              onApplyTarget={onApplyTarget}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PreviewContent({ preview, showAllDiffRows }) {
  if (!preview) {
    return <div className="preview-placeholder">选择左侧文件后，这里会显示替换前后的差异。</div>;
  }

  if (preview.loading) {
    return <div className="preview-placeholder">正在生成预览...</div>;
  }

  const rows = computeDiffRows(preview.beforeText || '', preview.afterText || '');
  const visibleRows = showAllDiffRows ? rows : rows.filter((row) => row.kind !== 'equal');
  const status = preview.hasChanges
    ? `命中 ${preview.replacementCount} 处`
    : '当前规则没有命中任何译文';
  const lineStatus = preview.hasChanges ? `影响 ${preview.changedLineCount} 行` : null;
  const modeStatus = showAllDiffRows ? '当前显示全部行' : '当前仅显示差异行';

  return (
    <>
      <div className="status-line">
        <span className="badge">{status}</span>
        {lineStatus ? <span className="badge">{lineStatus}</span> : null}
        <span className="badge">{modeStatus}</span>
      </div>
      <table className="diff-table">
        <colgroup>
          <col className="diff-col-line-number" />
          <col className="diff-col-content" />
          <col className="diff-col-line-number" />
          <col className="diff-col-content" />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2}>替换前</th>
            <th colSpan={2}>替换后</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length > 0 ? (
            visibleRows.map((row, index) => (
              <tr key={`${row.kind}-${row.beforeLineNumber}-${row.afterLineNumber}-${index}`} className={`diff-row ${row.kind}`}>
                <td className="diff-line-number before-cell">{row.beforeLineNumber}</td>
                <td className="diff-line before-cell">
                  <pre>{row.beforeText}</pre>
                </td>
                <td className="diff-line-number after-cell">{row.afterLineNumber}</td>
                <td className="diff-line after-cell">
                  <pre>{row.afterText}</pre>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="diff-empty">当前没有差异行可显示。</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function App() {
  const [rootPath, setRootPath] = useState(initialState.rootPath || '');
  const [tree, setTree] = useState(initialState.tree || null);
  const [rules, setRules] = useState(() => [createRule()]);
  const [selectedFile, setSelectedFile] = useState(initialState.initialSelectedFile || undefined);
  const [preview, setPreview] = useState(undefined);
  const [showAllDiffRows, setShowAllDiffRows] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());
  const [isComposing, setIsComposing] = useState(false);
  const [message, setMessage] = useState(undefined);

  const pendingRequestsRef = useRef(new Map());
  const latestPreviewRequestRef = useRef(0);
  const hasInitializedRulesEffectRef = useRef(false);
  const isComposingRef = useRef(false);
  const pendingPreviewResultRef = useRef(undefined);

  useEffect(() => {
    isComposingRef.current = isComposing;
    if (!isComposing && pendingPreviewResultRef.current) {
      const pending = pendingPreviewResultRef.current;
      pendingPreviewResultRef.current = undefined;
      if (pending.kind === 'error') {
        setMessage({ kind: 'error', text: pending.text });
      } else {
        setPreview(pending.payload);
        setMessage(undefined);
      }
    }
  }, [isComposing]);

  useEffect(() => {
    const handleMessage = (event) => {
      const messageEvent = event.data;
      const requestState = pendingRequestsRef.current.get(messageEvent.requestId);
      if (!requestState) {
        return;
      }
      pendingRequestsRef.current.delete(messageEvent.requestId);
      if (messageEvent.type === 'requestError') {
        requestState.reject(messageEvent.error);
        return;
      }
      requestState.resolve(messageEvent.payload);
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  function request(type, payload) {
    const requestId = uid(type);
    return new Promise((resolve, reject) => {
      pendingRequestsRef.current.set(requestId, { resolve, reject });
      vscode.postMessage({ type, requestId, ...payload });
    });
  }

  async function requestPreview(filePath, nextRules, showLoading) {
    if (!filePath) {
      return;
    }

    const requestToken = ++latestPreviewRequestRef.current;
    if (showLoading) {
      setPreview({
        filePath,
        fileName: basename(filePath),
        loading: true
      });
    }

    try {
      const payload = await request('previewFile', {
        filePath,
        rules: serializeRules(nextRules)
      });
      if (requestToken !== latestPreviewRequestRef.current) {
        return;
      }
      if (isComposingRef.current) {
        pendingPreviewResultRef.current = { kind: 'success', payload };
        return;
      }
      setPreview(payload);
      setMessage(undefined);
    } catch (error) {
      if (requestToken !== latestPreviewRequestRef.current) {
        return;
      }
      if (isComposingRef.current) {
        pendingPreviewResultRef.current = { kind: 'error', text: String(error) };
        return;
      }
      setMessage({ kind: 'error', text: String(error) });
    }
  }

  useEffect(() => {
    if (!selectedFile) {
      return;
    }
    void requestPreview(selectedFile, rules, true);
  }, []);

  useEffect(() => {
    if (!hasInitializedRulesEffectRef.current) {
      hasInitializedRulesEffectRef.current = true;
      return;
    }
    if (!selectedFile || isComposing) {
      return;
    }

    const handle = window.setTimeout(() => {
      void requestPreview(selectedFile, rules, false);
    }, 180);

    return () => {
      window.clearTimeout(handle);
    };
  }, [rules, isComposing]);

  function handleRuleChange(ruleId, field, value) {
    setRules((currentRules) => currentRules.map((rule) => (
      rule.id === ruleId ? { ...rule, [field]: value } : rule
    )));
  }

  function handleRuleMove(ruleId, direction) {
    setRules((currentRules) => {
      const index = currentRules.findIndex((rule) => rule.id === ruleId);
      if (index < 0) {
        return currentRules;
      }
      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= currentRules.length) {
        return currentRules;
      }
      const nextRules = currentRules.slice();
      const temp = nextRules[index];
      nextRules[index] = nextRules[nextIndex];
      nextRules[nextIndex] = temp;
      return nextRules;
    });
  }

  function handleRuleRemove(ruleId) {
    setRules((currentRules) => {
      const nextRules = currentRules.filter((rule) => rule.id !== ruleId);
      return nextRules.length > 0 ? nextRules : [createRule()];
    });
  }

  function handleAddRule() {
    setRules((currentRules) => [...currentRules, createRule()]);
  }

  function handleToggleFolder(folderPath) {
    setExpandedFolders((currentFolders) => {
      const nextFolders = new Set(currentFolders);
      if (nextFolders.has(folderPath)) {
        nextFolders.delete(folderPath);
      } else {
        nextFolders.add(folderPath);
      }
      return nextFolders;
    });
  }

  async function handleSelectFile(filePath) {
    setSelectedFile(filePath);
    await requestPreview(filePath, rules, true);
  }

  async function handleRefreshTree() {
    try {
      const payload = await request('refreshTree', { rootPath });
      setRootPath(payload.rootPath);
      setTree(payload.tree);
      const nextSelectedFile = findNodeByPath(payload.tree, selectedFile)
        ? selectedFile
        : payload.initialSelectedFile;
      setSelectedFile(nextSelectedFile);
      if (nextSelectedFile) {
        await requestPreview(nextSelectedFile, rules, false);
      } else {
        setPreview(undefined);
      }
    } catch (error) {
      setMessage({ kind: 'error', text: String(error) });
    }
  }

  async function handleApplyTarget(targetPath, targetKind) {
    if (!targetPath) {
      return;
    }

    const label = targetKind === 'folder' ? '目录' : '文件';
    setMessage({ kind: 'info', text: `正在替换${label}...` });

    try {
      const result = await request('applyTarget', {
        targetPath,
        targetKind,
        rules: serializeRules(rules)
      });
      const fragments = [
        `扫描 ${result.fileCount} 个文件`,
        `实际修改 ${result.changedFileCount} 个文件`,
        `共替换 ${result.replacementCount} 处`
      ];
      if (result.unsavedFileCount > 0) {
        fragments.push(`${result.unsavedFileCount} 个文件原本已存在未保存改动，替换后未自动保存`);
      }
      setMessage({ kind: 'info', text: fragments.join('，') });
      if (selectedFile) {
        await requestPreview(selectedFile, rules, false);
      }
    } catch (error) {
      setMessage({ kind: 'error', text: String(error) });
    }
  }

  const selectedLabel = selectedFile ? basename(selectedFile) : '未选择文件';

  return (
    <div className="layout">
      <aside className="sidebar">
        <section className="panel-section">
          <div className="section-header">
            <div className="section-title">
              <strong>替换规则</strong>
              <span className="subtle">规则按列表顺序依次应用到译文内容。</span>
            </div>
            <div className="header-actions">
              <button className="icon-button" title="添加规则" onClick={handleAddRule}>+</button>
            </div>
          </div>
          <div className="rules-list">
            {rules.map((rule, index) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                index={index}
                total={rules.length}
                onChange={handleRuleChange}
                onMove={handleRuleMove}
                onRemove={handleRuleRemove}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(ruleId, field, value) => {
                  setIsComposing(false);
                  handleRuleChange(ruleId, field, value);
                }}
              />
            ))}
          </div>
        </section>
        <section className="panel-section">
          <div className="section-header">
            <div className="section-title">
              <strong>文件浏览器</strong>
              <span className="subtle">当前工作区：{rootPath}</span>
            </div>
            <div className="header-actions">
              <button className="ghost" onClick={() => void handleRefreshTree()}>刷新</button>
            </div>
          </div>
          <div className="tree-shell">
            <div className="tree-root-actions">
              <span className="subtle">共 {tree ? tree.fileCount : 0} 个文本文件</span>
              <button onClick={() => void handleApplyTarget(rootPath, 'folder')}>替换当前工作区</button>
            </div>
            <div className="tree">
              {tree ? (
                <TreeNode
                  node={tree}
                  selectedFile={selectedFile}
                  expandedFolders={expandedFolders}
                  onToggleFolder={handleToggleFolder}
                  onSelectFile={handleSelectFile}
                  onApplyTarget={handleApplyTarget}
                />
              ) : (
                <div className="empty-state">没有找到可处理的文本文件。</div>
              )}
            </div>
          </div>
        </section>
      </aside>
      <section className="preview-panel">
        <div className="preview-header">
          <div className="preview-title">
            <strong>差异预览</strong>
            <span className="subtle">{selectedLabel}</span>
          </div>
          <div className="toolbar">
            <button className="ghost" onClick={() => setShowAllDiffRows((value) => !value)}>
              {showAllDiffRows ? '仅显示差异' : '显示全部'}
            </button>
            <button
              className="ghost"
              disabled={!selectedFile}
              onClick={() => {
                if (selectedFile) {
                  void requestPreview(selectedFile, rules, true);
                }
              }}
            >
              刷新预览
            </button>
            <button
              disabled={!selectedFile}
              onClick={() => {
                if (selectedFile) {
                  void handleApplyTarget(selectedFile, 'file');
                }
              }}
            >
              替换当前文件
            </button>
          </div>
        </div>
        <div className="preview-body">
          <PreviewContent preview={preview} showAllDiffRows={showAllDiffRows} />
          {message ? (
            <div className={`notice ${message.kind === 'error' ? 'error' : ''}`}>{message.text}</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

const rootElement = document.getElementById('view-root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
