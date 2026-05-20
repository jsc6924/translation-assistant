import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { React, createRoot, useEffect, useRef, useState } from './react-shared-runtime';

type TargetKind = 'folder' | 'file';
type RuleField = 'pattern' | 'replacement' | 'regexEnabled';
type MoveDirection = 'up' | 'down';
type DiffRowKind = 'equal' | 'added' | 'removed' | 'changed';

interface ReplaceRule {
	id: string;
	pattern: string;
	replacement: string;
	regexEnabled: boolean;
}

interface FileTreeNode {
	kind: TargetKind;
	name: string;
	path: string;
	relativePath: string;
	fileCount: number;
	children?: FileTreeNode[];
}

interface InitialStatePayload {
	rootPath: string;
	tree: FileTreeNode | null;
	initialSelectedFile?: string;
}

interface PreviewPayload {
	filePath: string;
	fileName: string;
	beforeText: string;
	afterText: string;
	changedLineCount: number;
	replacementCount: number;
	hasChanges: boolean;
}

interface PreviewState extends Partial<PreviewPayload> {
	filePath: string;
	fileName: string;
	loading?: boolean;
}

interface ApplyResult {
	targetPath: string;
	targetKind: TargetKind;
	fileCount: number;
	changedFileCount: number;
	changedLineCount: number;
	replacementCount: number;
	savedFileCount: number;
	unsavedFileCount: number;
}

interface DiffRow {
	kind: DiffRowKind;
	beforeLineNumber: string;
	afterLineNumber: string;
	beforeText: string;
	afterText: string;
}

interface PendingRequest {
	resolve: (payload: unknown) => void;
	reject: (error: string) => void;
}

interface RequestEnvelope {
	requestId?: string;
	type?: string;
	payload?: unknown;
	error?: string;
}

interface ExportRulesResult {
	saved: boolean;
}

type MessageState = { kind: 'info' | 'error'; text: string };
type PendingPreviewResult = { kind: 'success'; payload: PreviewPayload } | { kind: 'error'; text: string };

type RequestMap = {
	previewFile: PreviewPayload;
	applyTarget: ApplyResult;
	refreshTree: InitialStatePayload;
	exportRulesJson: ExportRulesResult;
};

interface RuleCardProps {
	rule: ReplaceRule;
	index: number;
	total: number;
	onChange: (ruleId: string, field: RuleField, value: string | boolean) => void;
	onMove: (ruleId: string, direction: MoveDirection) => void;
	onRemove: (ruleId: string) => void;
	onCompositionStart: () => void;
	onCompositionEnd: (ruleId: string, field: RuleField, value: string | boolean) => void;
}

interface TreeNodeProps {
	node: FileTreeNode;
	selectedFile?: string;
	expandedFolders: Set<string>;
	onToggleFolder: (folderPath: string) => void;
	onSelectFile: (filePath: string) => Promise<void>;
	onApplyTarget: (targetPath: string, targetKind: TargetKind) => Promise<void>;
}

interface PreviewContentProps {
	preview?: PreviewState;
	showAllDiffRows: boolean;
}

const vscode = acquireVsCodeApi();

function parseJsonElement<T>(elementId: string, fallback: T): T {
	const element = document.getElementById(elementId);
	if (!element?.textContent) {
		return fallback;
	}

	try {
		return JSON.parse(element.textContent) as T;
	} catch {
		return fallback;
	}
}

function toErrorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const initialState = parseJsonElement<InitialStatePayload>('initial-state', {
	rootPath: '',
	tree: null,
});

function uid(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createRule(): ReplaceRule {
	return {
		id: uid('rule'),
		pattern: '',
		replacement: '',
		regexEnabled: false,
	};
}

function basename(filePath?: string): string {
	return (filePath || '').split(/[/\\]/).pop() || filePath || '';
}

function serializeRules(rules: ReplaceRule[]): ReplaceRule[] {
	return rules.map((rule) => ({
		id: rule.id,
		pattern: rule.pattern,
		replacement: rule.replacement,
		regexEnabled: rule.regexEnabled,
	}));
}

function findNodeByPath(node: FileTreeNode | null | undefined, targetPath: string | undefined): FileTreeNode | undefined {
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

function splitLines(text: string): string[] {
	return text.length === 0 ? [''] : text.split(/\r?\n/);
}

function computeDiffRows(beforeText: string, afterText: string): DiffRow[] {
	const beforeLines = splitLines(beforeText);
	const afterLines = splitLines(afterText);
	if (beforeLines.length * afterLines.length <= 160000) {
		return computeLcsDiff(beforeLines, afterLines);
	}

	const rows: DiffRow[] = [];
	const max = Math.max(beforeLines.length, afterLines.length);
	for (let index = 0; index < max; index++) {
		const before = beforeLines[index];
		const after = afterLines[index];
		let kind: DiffRowKind = 'equal';
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
			afterText: after || '',
		});
	}
	return rows;
}

function computeLcsDiff(beforeLines: string[], afterLines: string[]): DiffRow[] {
	const rows: DiffRow[] = [];
	const m = beforeLines.length;
	const n = afterLines.length;

	let nextRow = new Array<number>(n + 1).fill(0);
	let currRow = new Array<number>(n + 1).fill(0);
	const hints = Array.from({ length: m }, () => new Uint8Array(n));

	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			if (beforeLines[i] === afterLines[j]) {
				currRow[j] = nextRow[j + 1] + 1;
				hints[i][j] = 0;
			} else {
				const scoreMovedI = nextRow[j];
				const scoreMovedJ = currRow[j + 1];

				if (scoreMovedI === scoreMovedJ) {
					currRow[j] = scoreMovedI;
					hints[i][j] = 1;
				} else if (scoreMovedI > scoreMovedJ) {
					currRow[j] = scoreMovedI;
					hints[i][j] = 2;
				} else {
					currRow[j] = scoreMovedJ;
					hints[i][j] = 3;
				}
			}
		}

		const temp = nextRow;
		nextRow = currRow;
		currRow = temp;
		currRow.fill(0);
	}

	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		const hint = hints[i][j];

		if (hint === 0) {
			rows.push({
				kind: 'equal',
				beforeLineNumber: String(i + 1),
				afterLineNumber: String(j + 1),
				beforeText: beforeLines[i],
				afterText: afterLines[j],
			});
			i++;
			j++;
		} else if (hint === 1) {
			rows.push({
				kind: 'changed',
				beforeLineNumber: String(i + 1),
				afterLineNumber: String(j + 1),
				beforeText: beforeLines[i],
				afterText: afterLines[j],
			});
			i++;
			j++;
		} else if (hint === 2) {
			rows.push({
				kind: 'removed',
				beforeLineNumber: String(i + 1),
				afterLineNumber: '',
				beforeText: beforeLines[i],
				afterText: '',
			});
			i++;
		} else {
			rows.push({
				kind: 'added',
				beforeLineNumber: '',
				afterLineNumber: String(j + 1),
				beforeText: '',
				afterText: afterLines[j],
			});
			j++;
		}
	}

	while (i < m) {
		rows.push({
			kind: 'removed',
			beforeLineNumber: String(i + 1),
			afterLineNumber: '',
			beforeText: beforeLines[i],
			afterText: '',
		});
		i++;
	}

	while (j < n) {
		rows.push({
			kind: 'added',
			beforeLineNumber: '',
			afterLineNumber: String(j + 1),
			beforeText: '',
			afterText: afterLines[j],
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
	onCompositionEnd,
}: RuleCardProps) {

	const searchSearch = rule.regexEnabled ? '正则表达式' : '查找文本';
	const searchReplace = rule.regexEnabled ? '正则替换' : '替换文本';
	const placeHolder1 = rule.regexEnabled ? '(\\w+)_old' : '请输入要替换的文本';
	const placeHolder2 = rule.regexEnabled ? '支持 $1、$2，以及 \\n / \\t 等转义' : '请输入替换内容';
	
	return (
		<section className="rule-card">
			<div className="rule-card-header">
				<div className="rule-index">规则 {index + 1}</div>
				<div className="rule-actions">
					<button
						className={`ghost icon-button ${rule.regexEnabled ? 'active' : ''}`}
						onClick={() => {
							onChange(rule.id, 'regexEnabled', !rule.regexEnabled);
						}}
					>
						.*
					</button>
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
				<span>{searchSearch}</span>
				<input
					type="text"
					placeholder={placeHolder1}
					value={rule.pattern}
					onChange={(event) => onChange(rule.id, 'pattern', event.target.value)}
					onCompositionStart={onCompositionStart}
					onCompositionEnd={(event) => onCompositionEnd(rule.id, 'pattern', event.currentTarget.value)}
				/>
			</label>
			<label className="field-label">
				<span>{searchReplace}</span>
				<input
					type="text"
					placeholder={placeHolder2}
					value={rule.replacement}
					onChange={(event) => onChange(rule.id, 'replacement', event.target.value)}
					onCompositionStart={onCompositionStart}
					onCompositionEnd={(event) => onCompositionEnd(rule.id, 'replacement', event.currentTarget.value)}
				/>
			</label>
		</section>
	);
}

function TreeNode({ node, selectedFile, expandedFolders, onToggleFolder, onSelectFile, onApplyTarget }: TreeNodeProps) {
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

function PreviewContent({ preview, showAllDiffRows }: PreviewContentProps) {
	if (!preview) {
		return <div className="preview-placeholder">选择左侧文件后，这里会显示替换前后的差异。</div>;
	}

	if (preview.loading) {
		return <div className="preview-placeholder">正在生成预览...</div>;
	}

	const rows = computeDiffRows(preview.beforeText || '', preview.afterText || '');
	const visibleRows = showAllDiffRows ? rows : rows.filter((row) => row.kind !== 'equal');
	const status = preview.hasChanges
		? `命中 ${preview.replacementCount || 0} 处`
		: '当前规则没有命中任何译文';
	const lineStatus = preview.hasChanges ? `影响 ${preview.changedLineCount || 0} 行` : undefined;
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
	const [tree, setTree] = useState<FileTreeNode | null>(initialState.tree);
	const [rules, setRules] = useState<ReplaceRule[]>(() => [createRule()]);
	const [selectedFile, setSelectedFile] = useState<string | undefined>(initialState.initialSelectedFile);
	const [preview, setPreview] = useState<PreviewState | undefined>(undefined);
	const [showAllDiffRows, setShowAllDiffRows] = useState(true);
	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
	const [isComposing, setIsComposing] = useState(false);
	const [message, setMessage] = useState<MessageState | undefined>(undefined);
	const [rulesPanelHeight, setRulesPanelHeight] = useState(280);
	const [isDragging, setIsDragging] = useState(false);
	const [sidebarWidth, setSidebarWidth] = useState(420);
	const [isHorizontalDragging, setIsHorizontalDragging] = useState(false);

	const sidebarRef = useRef<HTMLElement | null>(null);
	const layoutRef = useRef<HTMLDivElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());
	const latestPreviewRequestRef = useRef(0);
	const hasInitializedRulesEffectRef = useRef(false);
	const isComposingRef = useRef(false);
	const pendingPreviewResultRef = useRef<PendingPreviewResult | undefined>(undefined);

	function handleResizerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
		event.preventDefault();
		setIsDragging(true);
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function handleResizerPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
		if (!isDragging || !sidebarRef.current) {
			return;
		}

		const rect = sidebarRef.current.getBoundingClientRect();
		const computedHeight = event.clientY - rect.top;
		const minHeight = 120;
		const maxHeight = rect.height - 160;

		if (computedHeight >= minHeight && computedHeight <= maxHeight) {
			setRulesPanelHeight(computedHeight);
		}
	}

	function handleResizerPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
		if (!isDragging) {
			return;
		}
		setIsDragging(false);
		event.currentTarget.releasePointerCapture(event.pointerId);
	}

	function handleHorizontalPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
		event.preventDefault();
		setIsHorizontalDragging(true);
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function handleHorizontalPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
		if (!isHorizontalDragging || !layoutRef.current) {
			return;
		}

		const rect = layoutRef.current.getBoundingClientRect();
		const computedWidth = event.clientX - rect.left;
		const minWidth = 360;
		const maxWidth = rect.width - 420;

		if (computedWidth >= minWidth && computedWidth <= maxWidth) {
			setSidebarWidth(computedWidth);
		}
	}

	function handleHorizontalPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
		if (!isHorizontalDragging) {
			return;
		}
		setIsHorizontalDragging(false);
		event.currentTarget.releasePointerCapture(event.pointerId);
	}

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
		const handleMessage = (event: MessageEvent<RequestEnvelope>) => {
			const messageEvent = event.data;
			const requestId = messageEvent.requestId;
			if (!requestId) {
				return;
			}

			const requestState = pendingRequestsRef.current.get(requestId);
			if (!requestState) {
				return;
			}

			pendingRequestsRef.current.delete(requestId);
			if (messageEvent.type === 'requestError') {
				requestState.reject(messageEvent.error || '未知错误');
				return;
			}

			requestState.resolve(messageEvent.payload);
		};

		window.addEventListener('message', handleMessage);
		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, []);

	function request<T extends keyof RequestMap>(type: T, payload: Record<string, unknown>): Promise<RequestMap[T]> {
		const requestId = uid(type);
		return new Promise((resolve, reject) => {
			pendingRequestsRef.current.set(requestId, {
				resolve: (responsePayload) => resolve(responsePayload as RequestMap[T]),
				reject,
			});
			vscode.postMessage({ type, requestId, ...payload });
		});
	}

	async function requestPreview(filePath: string, nextRules: ReplaceRule[], showLoading: boolean): Promise<void> {
		if (!filePath) {
			return;
		}

		const requestToken = ++latestPreviewRequestRef.current;
		if (showLoading) {
			setPreview({
				filePath,
				fileName: basename(filePath),
				loading: true,
			});
		}

		try {
			const payload = await request('previewFile', {
				filePath,
				rules: serializeRules(nextRules),
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
			const text = toErrorText(error);
			if (isComposingRef.current) {
				pendingPreviewResultRef.current = { kind: 'error', text };
				return;
			}
			setMessage({ kind: 'error', text });
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

	function handleRuleChange(ruleId: string, field: RuleField, value: string | boolean) {
		setRules((currentRules) => currentRules.map((rule) => (
			rule.id === ruleId ? { ...rule, [field]: value } : rule
		)));
	}

	async function handleExportRules(): Promise<void> {
		try {
			const serialized = serializeRules(rules);
			const result = await request('exportRulesJson', { rules: serialized });
			setMessage({ kind: 'info', text: result.saved ? '规则配置已成功导出' : '已取消导出' });
		} catch (error) {
			setMessage({ kind: 'error', text: `导出失败: ${toErrorText(error)}` });
		}
	}

	function triggerImportClick() {
		if (fileInputRef.current) {
			fileInputRef.current.click();
		}
	}

	function handleImportRules(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) {
			return;
		}

		const reader = new FileReader();
		reader.onload = (loadEvent) => {
			try {
				const content = loadEvent.target?.result;
				if (typeof content !== 'string') {
					throw new Error('无法读取文件内容');
				}

				const parsed = JSON.parse(content) as unknown;
				if (!Array.isArray(parsed)) {
					throw new Error('JSON 格式不正确，预期为规则数组');
				}

				const nextRules = parsed.map((item) => {
					const rule = (typeof item === 'object' && item) ? item as Partial<ReplaceRule> : {};
					return {
						id: uid('rule'),
						pattern: String(rule.pattern || ''),
						replacement: String(rule.replacement || ''),
						regexEnabled: Boolean(rule.regexEnabled),
					};
				});

				setRules(nextRules.length > 0 ? nextRules : [createRule()]);
				setMessage({ kind: 'info', text: `成功导入 ${nextRules.length} 条规则` });
			} catch (error) {
				setMessage({ kind: 'error', text: `导入解析失败: ${toErrorText(error)}` });
			} finally {
				event.target.value = '';
			}
		};
		reader.readAsText(file, 'utf-8');
	}

	function handleRuleMove(ruleId: string, direction: MoveDirection) {
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

	function handleRuleRemove(ruleId: string) {
		setRules((currentRules) => {
			const nextRules = currentRules.filter((rule) => rule.id !== ruleId);
			return nextRules.length > 0 ? nextRules : [createRule()];
		});
	}

	function handleAddRule() {
		setRules((currentRules) => [...currentRules, createRule()]);
	}

	function handleToggleFolder(folderPath: string) {
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

	async function handleSelectFile(filePath: string): Promise<void> {
		setSelectedFile(filePath);
		await requestPreview(filePath, rules, true);
	}

	async function handleRefreshTree(): Promise<void> {
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
			setMessage({ kind: 'error', text: toErrorText(error) });
		}
	}

	async function handleApplyTarget(targetPath: string, targetKind: TargetKind): Promise<void> {
		if (!targetPath) {
			return;
		}

		const label = targetKind === 'folder' ? '目录' : '文件';
		setMessage({ kind: 'info', text: `正在替换${label}...` });

		try {
			const result = await request('applyTarget', {
				targetPath,
				targetKind,
				rules: serializeRules(rules),
			});
			const fragments = [
				`扫描 ${result.fileCount} 个文件`,
				`实际修改 ${result.changedFileCount} 个文件`,
				`共替换 ${result.replacementCount} 处`,
			];
			if (result.unsavedFileCount > 0) {
				fragments.push(`${result.unsavedFileCount} 个文件原本已存在未保存改动，替换后未自动保存`);
			}
			setMessage({ kind: 'info', text: fragments.join('，') });
			if (selectedFile) {
				await requestPreview(selectedFile, rules, false);
			}
		} catch (error) {
			setMessage({ kind: 'error', text: toErrorText(error) });
		}
	}

	const selectedLabel = selectedFile ? basename(selectedFile) : '未选择文件';

	return (
		<div className="layout" ref={layoutRef}>
			<aside
				className="sidebar"
				ref={sidebarRef}
				style={{ width: `${sidebarWidth}px`, flexShrink: 0 }}
			>
				<section
					className="panel-section"
					style={{ height: `${rulesPanelHeight}px`, flexShrink: 0 }}
				>
					<div className="section-header">
						<div className="section-title">
							<strong>替换规则</strong>
							<span className="subtle">规则按列表顺序依次应用到译文内容。</span>
						</div>
						<div className="header-actions">
							<button className="ghost" title="导入规则" onClick={triggerImportClick}>导入</button>
							<button className="ghost" title="导出规则" onClick={() => void handleExportRules()}>导出</button>
							<button className="icon-button" title="添加规则" onClick={handleAddRule}>+</button>
							<input
								type="file"
								ref={fileInputRef}
								style={{ display: 'none' }}
								accept=".json"
								onChange={handleImportRules}
							/>
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

				<div
					className={`sidebar-resizer ${isDragging ? 'dragging' : ''}`}
					onPointerDown={handleResizerPointerDown}
					onPointerMove={handleResizerPointerMove}
					onPointerUp={handleResizerPointerUp}
				/>

				<section className="panel-section" style={{ flex: 1 }}>
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

			<div
				className={`layout-resizer ${isHorizontalDragging ? 'dragging' : ''}`}
				onPointerDown={handleHorizontalPointerDown}
				onPointerMove={handleHorizontalPointerMove}
				onPointerUp={handleHorizontalPointerUp}
			/>

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