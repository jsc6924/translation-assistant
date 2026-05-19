(function () {
  const vscode = acquireVsCodeApi();
  const initialState = JSON.parse(document.getElementById('initial-state').textContent || '{}');

  const state = {
    rootPath: initialState.rootPath || '',
    tree: initialState.tree || null,
    rules: [],
    selectedFile: initialState.initialSelectedFile || undefined,
    preview: undefined,
    showAllDiffRows: true,
    expandedFolders: new Set(),
    isComposing: false,
    message: undefined,
    pendingRequests: new Map()
  };

  function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function request(type, payload) {
    const requestId = uid(type);
    const promise = new Promise((resolve, reject) => {
      state.pendingRequests.set(requestId, { resolve, reject, type });
    });
    vscode.postMessage({ type, requestId, ...payload });
    return promise;
  }

  function setMessage(kind, text) {
    state.message = text ? { kind, text } : undefined;
    render();
  }

  function ensureAtLeastOneRule() {
    if (state.rules.length === 0) {
      state.rules.push(createRule());
    }
  }

  function createRule() {
    return {
      id: uid('rule'),
      pattern: '',
      replacement: ''
    };
  }

  function getActiveRules() {
    return state.rules.map((rule) => ({
      id: rule.id,
      pattern: rule.pattern,
      replacement: rule.replacement
    }));
  }

  function debouncePreview() {
    if (!state.selectedFile) {
      return;
    }
    window.clearTimeout(debouncePreview.timer);
    debouncePreview.timer = window.setTimeout(() => {
      void loadPreview(state.selectedFile, false);
    }, 180);
  }

  async function loadPreview(filePath, showLoading) {
    if (!filePath) {
      return;
    }
    if (showLoading) {
      state.preview = {
        filePath,
        fileName: filePath.split(/[/\\]/).pop(),
        loading: true
      };
      if (!state.isComposing) {
        render();
      }
    }
    try {
      const payload = await request('previewFile', {
        filePath,
        rules: getActiveRules()
      });
      state.preview = payload;
      setMessage(undefined, undefined);
      if (!state.isComposing) {
        render();
      }
    } catch (error) {
      setMessage('error', String(error));
      if (!state.isComposing) {
        render();
      }
    }
  }

  async function applyTarget(targetPath, targetKind) {
    if (!targetPath) {
      return;
    }
    const label = targetKind === 'folder' ? '目录' : '文件';
    setMessage(undefined, `正在替换${label}...`);
    try {
      const result = await request('applyTarget', {
        targetPath,
        targetKind,
        rules: getActiveRules()
      });
      const fragments = [
        `扫描 ${result.fileCount} 个文件`,
        `实际修改 ${result.changedFileCount} 个文件`,
        `共替换 ${result.replacementCount} 处`
      ];
      if (result.unsavedFileCount > 0) {
        fragments.push(`${result.unsavedFileCount} 个文件原本已存在未保存改动，替换后未自动保存`);
      }
      setMessage('info', fragments.join('，'));
      if (state.selectedFile) {
        await loadPreview(state.selectedFile, false);
      }
    } catch (error) {
      setMessage('error', String(error));
    }
  }

  async function refreshTree() {
    try {
      const payload = await request('refreshTree', { rootPath: state.rootPath });
      state.rootPath = payload.rootPath;
      state.tree = payload.tree;
      if (!findNodeByPath(state.tree, state.selectedFile)) {
        state.selectedFile = payload.initialSelectedFile;
      }
      render();
      if (state.selectedFile) {
        await loadPreview(state.selectedFile, false);
      }
    } catch (error) {
      setMessage('error', String(error));
    }
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

  function renderRuleCard(rule, index) {
    const disabledUp = index === 0 ? 'disabled' : '';
    const disabledDown = index === state.rules.length - 1 ? 'disabled' : '';
    return `
      <section class="rule-card" data-rule-id="${escapeAttr(rule.id)}">
        <div class="rule-card-header">
          <div class="rule-index">规则 ${index + 1}</div>
          <div class="rule-actions">
            <button class="ghost icon-button" data-action="move-rule" data-direction="up" data-rule-id="${escapeAttr(rule.id)}" ${disabledUp}>↑</button>
            <button class="ghost icon-button" data-action="move-rule" data-direction="down" data-rule-id="${escapeAttr(rule.id)}" ${disabledDown}>↓</button>
            <button class="ghost danger icon-button" data-action="remove-rule" data-rule-id="${escapeAttr(rule.id)}">×</button>
          </div>
        </div>
        <label class="field-label">
          <span>正则表达式</span>
          <input type="text" placeholder="例如：(\\w+)_old" data-field="pattern" data-rule-id="${escapeAttr(rule.id)}" value="${escapeAttr(rule.pattern)}">
        </label>
        <label class="field-label">
          <span>替换内容</span>
          <input type="text" placeholder="支持 $1、$2，以及 \\n / \\t 等转义" data-field="replacement" data-rule-id="${escapeAttr(rule.id)}" value="${escapeAttr(rule.replacement)}">
        </label>
      </section>`;
  }

  function renderTreeNode(node) {
    const isActive = node.kind === 'file' && node.path === state.selectedFile;
    const isExpanded = node.kind === 'folder' && state.expandedFolders.has(node.path);
    const icon = node.kind === 'folder' ? '📁' : '📄';
    const actionLabel = node.kind === 'folder' ? '替换目录' : '替换';
    const meta = node.kind === 'folder' ? `${node.fileCount} 个文本文件` : node.relativePath;
    const children = node.kind === 'folder' && isExpanded ? (node.children || []).map(renderTreeNode).join('') : '';
    const folderToggle = node.kind === 'folder'
      ? `<button class="ghost icon-button folder-toggle" data-action="toggle-folder" data-path="${escapeAttr(node.path)}">${isExpanded ? 'V' : '>'}</button>`
      : '';

    return `
      <div class="tree-node">
        <div class="tree-row ${isActive ? 'active' : ''}" data-selectable="${node.kind === 'file' ? 'true' : 'false'}" data-path="${escapeAttr(node.path)}" data-kind="${node.kind}">
          <div class="tree-node-main">
            ${folderToggle}
            <div>${icon}</div>
            <div class="tree-label">
              <div class="tree-name">${escapeHtml(node.name)}</div>
              <div class="tree-path">${escapeHtml(meta)}</div>
            </div>
          </div>
          <button class="ghost" data-action="apply-target" data-target-kind="${node.kind}" data-target-path="${escapeAttr(node.path)}">${actionLabel}</button>
        </div>
        ${children ? `<div class="tree-children">${children}</div>` : ''}
      </div>`;
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
    const matrix = Array.from({ length: beforeLines.length + 1 }, () => new Array(afterLines.length + 1).fill(0));
    for (let i = beforeLines.length - 1; i >= 0; i--) {
      for (let j = afterLines.length - 1; j >= 0; j--) {
        if (beforeLines[i] === afterLines[j]) {
          matrix[i][j] = matrix[i + 1][j + 1] + 1;
        } else {
          matrix[i][j] = Math.max(matrix[i + 1][j], matrix[i][j + 1]);
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < beforeLines.length && j < afterLines.length) {
      if (beforeLines[i] === afterLines[j]) {
        rows.push({
          kind: 'equal',
          beforeLineNumber: String(i + 1),
          afterLineNumber: String(j + 1),
          beforeText: beforeLines[i],
          afterText: afterLines[j]
        });
        i++;
        j++;
        continue;
      }

      if (matrix[i + 1][j] === matrix[i][j + 1]) {
        rows.push({
          kind: 'changed',
          beforeLineNumber: String(i + 1),
          afterLineNumber: String(j + 1),
          beforeText: beforeLines[i],
          afterText: afterLines[j]
        });
        i++;
        j++;
      } else if (matrix[i + 1][j] > matrix[i][j + 1]) {
        rows.push({
          kind: 'removed',
          beforeLineNumber: String(i + 1),
          afterLineNumber: '',
          beforeText: beforeLines[i],
          afterText: ''
        });
        i++;
      } else {
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

    while (i < beforeLines.length) {
      rows.push({
        kind: 'removed',
        beforeLineNumber: String(i + 1),
        afterLineNumber: '',
        beforeText: beforeLines[i],
        afterText: ''
      });
      i++;
    }

    while (j < afterLines.length) {
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

  function splitLines(text) {
    return text.length === 0 ? [''] : text.split(/\r?\n/);
  }

  function renderPreview() {
    if (!state.preview) {
      return `<div class="preview-placeholder">选择左侧文件后，这里会显示替换前后的差异。</div>`;
    }
    if (state.preview.loading) {
      return `<div class="preview-placeholder">正在生成预览...</div>`;
    }

    const rows = computeDiffRows(state.preview.beforeText || '', state.preview.afterText || '');
    const visibleRows = state.showAllDiffRows ? rows : rows.filter((row) => row.kind !== 'equal');
    const diffRows = visibleRows.map((row) => `
      <tr class="diff-row ${row.kind}">
        <td class="diff-line-number before-cell">${row.beforeLineNumber}</td>
        <td class="diff-line before-cell"><pre>${escapeHtml(row.beforeText)}</pre></td>
        <td class="diff-line-number after-cell">${row.afterLineNumber}</td>
        <td class="diff-line after-cell"><pre>${escapeHtml(row.afterText)}</pre></td>
      </tr>`).join('');

    const status = state.preview.hasChanges
      ? `<span class="badge">命中 ${state.preview.replacementCount} 处</span><span class="badge">影响 ${state.preview.changedLineCount} 行</span>`
      : '<span class="badge">当前规则没有命中任何译文</span>';
    const modeStatus = `<span class="badge">${state.showAllDiffRows ? '当前显示全部行' : '当前仅显示差异行'}</span>`;
    const tableRows = diffRows || '<tr><td colspan="4" class="diff-empty">当前没有差异行可显示。</td></tr>';

    return `
      <div class="status-line">
        ${status}
        ${modeStatus}
      </div>
      <table class="diff-table">
        <colgroup>
          <col class="diff-col-line-number">
          <col class="diff-col-content">
          <col class="diff-col-line-number">
          <col class="diff-col-content">
        </colgroup>
        <thead>
          <tr>
            <th colspan="2">替换前</th>
            <th colspan="2">替换后</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`;
  }

  function renderMessage() {
    if (!state.message) {
      return '';
    }
    return `<div class="notice ${state.message.kind === 'error' ? 'error' : ''}">${escapeHtml(state.message.text)}</div>`;
  }

  function render() {
    ensureAtLeastOneRule();
    const root = document.getElementById('view-root');
    const rulesList = root.querySelector('.rules-list');
    const rulesScrollTop = rulesList ? rulesList.scrollTop : 0;
    let restoreFocus = null;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const ruleId = active.getAttribute('data-rule-id');
      const field = active.getAttribute('data-field');
      if (ruleId && field && active.closest('.rules-list')) {
        restoreFocus = {
          ruleId,
          field,
          selectionStart: active.selectionStart,
          selectionEnd: active.selectionEnd
        };
      }
    }
    const selectedLabel = state.selectedFile ? state.selectedFile.split(/[/\\]/).pop() : '未选择文件';
    root.innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <section class="panel-section">
            <div class="section-header">
              <div class="section-title">
                <strong>替换规则</strong>
                <span class="subtle">规则按列表顺序依次应用到译文内容。</span>
              </div>
              <div class="header-actions">
                <button class="icon-button" data-action="add-rule" title="添加规则">+</button>
              </div>
            </div>
            <div class="rules-list">
              ${state.rules.map(renderRuleCard).join('')}
            </div>
          </section>
          <section class="panel-section">
            <div class="section-header">
              <div class="section-title">
                <strong>文件浏览器</strong>
                <span class="subtle">当前工作区：${escapeHtml(state.rootPath || '')}</span>
              </div>
              <div class="header-actions">
                <button class="ghost" data-action="refresh-tree">刷新</button>
              </div>
            </div>
            <div class="tree-shell">
              <div class="tree-root-actions">
                <span class="subtle">共 ${state.tree ? state.tree.fileCount : 0} 个文本文件</span>
                <button data-action="apply-target" data-target-kind="folder" data-target-path="${escapeAttr(state.rootPath)}">替换当前工作区</button>
              </div>
              <div class="tree">
                ${state.tree ? renderTreeNode(state.tree) : '<div class="empty-state">没有找到可处理的文本文件。</div>'}
              </div>
            </div>
          </section>
        </aside>
        <section class="preview-panel">
          <div class="preview-header">
            <div class="preview-title">
              <strong>差异预览</strong>
              <span class="subtle">${escapeHtml(selectedLabel)}</span>
            </div>
            <div class="toolbar">
              <button class="ghost" data-action="toggle-diff-mode">${state.showAllDiffRows ? '仅显示差异' : '显示全部'}</button>
              <button class="ghost" data-action="preview-selected" ${state.selectedFile ? '' : 'disabled'}>刷新预览</button>
              <button data-action="apply-selected" ${state.selectedFile ? '' : 'disabled'}>替换当前文件</button>
            </div>
          </div>
          <div class="preview-body">
            ${renderPreview()}
            ${renderMessage()}
          </div>
        </section>
      </div>`;

    const newRulesList = root.querySelector('.rules-list');
    if (newRulesList) {
      newRulesList.scrollTop = rulesScrollTop;
    }
    if (restoreFocus) {
      const target = root.querySelector(
        `[data-field="${restoreFocus.field}"][data-rule-id="${restoreFocus.ruleId}"]`
      );
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.focus();
        if (typeof restoreFocus.selectionStart === 'number' && typeof restoreFocus.selectionEnd === 'number') {
          target.setSelectionRange(restoreFocus.selectionStart, restoreFocus.selectionEnd);
        }
      }
    }

    bindEvents(root);
  }

  function bindEvents(root) {
    root.querySelectorAll('[data-action="add-rule"]').forEach((button) => {
      button.addEventListener('click', () => {
        state.rules.push(createRule());
        render();
      });
    });

    root.querySelectorAll('[data-action="remove-rule"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const ruleId = event.currentTarget.getAttribute('data-rule-id');
        state.rules = state.rules.filter((rule) => rule.id !== ruleId);
        ensureAtLeastOneRule();
        render();
        debouncePreview();
      });
    });

    root.querySelectorAll('[data-action="move-rule"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const ruleId = event.currentTarget.getAttribute('data-rule-id');
        const direction = event.currentTarget.getAttribute('data-direction');
        const index = state.rules.findIndex((rule) => rule.id === ruleId);
        if (index < 0) {
          return;
        }
        const nextIndex = direction === 'up' ? index - 1 : index + 1;
        if (nextIndex < 0 || nextIndex >= state.rules.length) {
          return;
        }
        const clone = state.rules.slice();
        const temp = clone[index];
        clone[index] = clone[nextIndex];
        clone[nextIndex] = temp;
        state.rules = clone;
        render();
        debouncePreview();
      });
    });

    root.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('compositionstart', () => {
        state.isComposing = true;
      });
      input.addEventListener('compositionend', (event) => {
        state.isComposing = false;
        const field = event.currentTarget.getAttribute('data-field');
        const ruleId = event.currentTarget.getAttribute('data-rule-id');
        const rule = state.rules.find((item) => item.id === ruleId);
        if (rule) {
          rule[field] = event.currentTarget.value;
        }
        debouncePreview();
      });
      input.addEventListener('input', (event) => {
        const field = event.currentTarget.getAttribute('data-field');
        const ruleId = event.currentTarget.getAttribute('data-rule-id');
        const rule = state.rules.find((item) => item.id === ruleId);
        if (!rule) {
          return;
        }
        rule[field] = event.currentTarget.value;
        if (!state.isComposing) {
          debouncePreview();
        }
      });
    });

    root.querySelectorAll('[data-selectable="true"]').forEach((row) => {
      row.addEventListener('click', async (event) => {
        if (event.target.closest('button')) {
          return;
        }
        const filePath = event.currentTarget.getAttribute('data-path');
        if (!filePath) {
          return;
        }
        state.selectedFile = filePath;
        await loadPreview(filePath, true);
        render();
      });
    });

    root.querySelectorAll('[data-action="refresh-tree"]').forEach((button) => {
      button.addEventListener('click', () => {
        void refreshTree();
      });
    });

    root.querySelectorAll('[data-action="apply-target"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const targetPath = event.currentTarget.getAttribute('data-target-path');
        const targetKind = event.currentTarget.getAttribute('data-target-kind');
        void applyTarget(targetPath, targetKind);
      });
    });

    root.querySelectorAll('[data-action="toggle-folder"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const path = event.currentTarget.getAttribute('data-path');
        if (!path) {
          return;
        }
        if (state.expandedFolders.has(path)) {
          state.expandedFolders.delete(path);
        } else {
          state.expandedFolders.add(path);
        }
        render();
      });
    });

    root.querySelectorAll('[data-action="preview-selected"]').forEach((button) => {
      button.addEventListener('click', () => {
        void loadPreview(state.selectedFile, true);
      });
    });

    root.querySelectorAll('[data-action="toggle-diff-mode"]').forEach((button) => {
      button.addEventListener('click', () => {
        state.showAllDiffRows = !state.showAllDiffRows;
        render();
      });
    });

    root.querySelectorAll('[data-action="apply-selected"]').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.selectedFile) {
          void applyTarget(state.selectedFile, 'file');
        }
      });
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/`/g, '&#096;');
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    const request = state.pendingRequests.get(message.requestId);
    if (!request) {
      return;
    }
    state.pendingRequests.delete(message.requestId);
    if (message.type === 'requestError') {
      request.reject(message.error);
      return;
    }
    request.resolve(message.payload);
  });

  render();
  if (state.selectedFile) {
    void loadPreview(state.selectedFile, true);
  }
})();