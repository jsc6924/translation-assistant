import { React, createRoot, useEffect, useRef, useState } from './react-shared-runtime';
import { vscode } from './vscode';
import type {
    ExtractConfig, PackConfig, ConcatConfig, MergeConfig,
    WordcountConfig, TransformConfig,
} from './dlbuild-shared-types';

type TabId = 'extract' | 'pack' | 'concat' | 'merge' | 'wordcount' | 'transform';

interface TabDef { id: TabId; label: string }
const TABS: TabDef[] = [
    { id: 'extract', label: '提取' },
    { id: 'pack', label: '打包' },
    { id: 'concat', label: '连接' },
    { id: 'merge', label: '合并' },
    { id: 'wordcount', label: '字数' },
    { id: 'transform', label: '转换' },
];

const ENCODINGS = ['auto', 'utf8', 'utf8-bom', 'utf16le', 'utf16le-bom', 'utf16be', 'utf16be-bom', 'shift-jis', 'gb2312', 'gbk'];

interface InitialState {
    rootPath: string;
}

function parseJsonElement<T>(elementId: string, fallback: T): T {
    const el = document.getElementById(elementId);
    if (!el?.textContent) { return fallback; }
    try { return JSON.parse(el.textContent) as T; } catch { return fallback; }
}

const initialState = parseJsonElement<InitialState>('initial-state', { rootPath: '' });

function uid(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ---- 公共表单控件 ----

function PathInput({ value, onChange, isDirectory, placeholder }: {
    value: string; onChange: (v: string) => void; isDirectory: boolean; placeholder?: string;
}) {
    const handleBrowse = () => {
        vscode.postMessage({
            type: isDirectory ? 'openDirectoryDialog' : 'openFileDialog',
            requestId: uid('dlg'),
        });
    };
    // 监听 dialogResult
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data;
            if ((msg.type === 'dialogResult') && msg.requestId) {
                // 仅当最近一次请求匹配；这里简化：直接填入
                if (msg.fsPath) {
                    const rel = msg.fsPath.startsWith(initialState.rootPath)
                        ? '.' + msg.fsPath.slice(initialState.rootPath.length)
                        : msg.fsPath;
                    onChange(rel);
                }
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);
    return (
        <div className="path-input">
            <input type="text" value={value} placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)} />
            <button className="ghost" type="button" onClick={handleBrowse}>浏览</button>
        </div>
    );
}

function EncodingSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
            {ENCODINGS.map((enc) => <option key={enc} value={enc}>{enc}</option>)}
        </select>
    );
}

// ---- 各表单初始值 ----

function defaultExtract(): ExtractConfig {
    return {
        input: { path: './input/', encoding: 'shift-jis', ext: 'ks', digits: 5, items: [{ capture: '@Talk .*?name=(\\S+)', tag: 'nme', group: 1 }] },
        output: { path: './output/', encoding: 'utf16le-bom' },
    };
}

function defaultPack(): PackConfig {
    return { input: { path: './output/', encoding: 'utf16le-bom' }, output: { path: './replaced/', encoding: 'utf16le-bom' } };
}

function defaultConcat(): ConcatConfig {
    return { input: { path: './input-folder', encoding: 'auto' }, output: { path: './concated', encoding: 'utf16le-bom' } };
}

function defaultMerge(): MergeConfig {
    return {
        input1: { path: './data_text', encoding: 'utf16le-bom' },
        input2: { path: './chs_text', encoding: 'utf16le-bom' },
        output: { path: './merge-output', encoding: 'utf16le-bom' },
    };
}

function defaultWordcount(): WordcountConfig {
    return { input: { path: './input-folder', encoding: 'auto' } };
}

function defaultTransform(): TransformConfig {
    return {
        input: { path: './test', encoding: 'utf8' },
        output: { path: './transform-output', encoding: 'utf8' },
        mode: 'line',
        operations: [{ 'select': '@translation' }, { 'commit': '' }],
    };
}

// ---- 表单组件 ----

function ExtractForm({ config, onChange }: { config: ExtractConfig; onChange: (c: ExtractConfig) => void }) {
    const updateInput = (patch: Partial<ExtractConfig['input']>) => onChange({ ...config, input: { ...config.input, ...patch } });
    const updateOutput = (patch: Partial<ExtractConfig['output']>) => onChange({ ...config, output: { ...config.output, ...patch } });
    const updateItem = (index: number, patch: Partial<ExtractConfig['input']['items'][0]>) => {
        const items = config.input.items.map((it, i) => i === index ? { ...it, ...patch } : it);
        updateInput({ items });
    };
    const addItem = () => updateInput({ items: [...config.input.items, { capture: '', tag: '', group: 1 }] });
    const removeItem = (i: number) => updateInput({ items: config.input.items.filter((_, idx) => idx !== i) });
    const moveItem = (i: number, dir: -1 | 1) => {
        const items = [...config.input.items];
        const j = i + dir;
        if (j < 0 || j >= items.length) { return; }
        [items[i], items[j]] = [items[j], items[i]];
        updateInput({ items });
    };

    return (
        <div>
            <div className="form-section">
                <div className="form-section-title">输入</div>
                <div className="field">
                    <div className="field-label">输入路径</div>
                    <PathInput value={config.input.path} onChange={(v) => updateInput({ path: v })} isDirectory placeholder="./input/" />
                </div>
                <div className="two-col">
                    <div className="field">
                        <div className="field-label">输入编码</div>
                        <EncodingSelect value={config.input.encoding} onChange={(v) => updateInput({ encoding: v })} />
                    </div>
                    <div className="field">
                        <div className="field-label">文件后缀（空=全部）</div>
                        <input type="text" value={config.input.ext} placeholder="ks"
                            onChange={(e) => updateInput({ ext: e.target.value })} />
                    </div>
                </div>
                <div className="field">
                    <div className="field-label">标签数字位数</div>
                    <input type="number" min="1" value={config.input.digits}
                        onChange={(e) => updateInput({ digits: Number(e.target.value) || 1 })} />
                </div>
            </div>

            <div className="form-section">
                <div className="form-section-title">提取项（按顺序匹配）</div>
                <div className="item-list-header">
                    <span className="item-index header-spacer"></span>
                    <div className="header-cell">正则表达式</div>
                    <div className="header-cell">标签前缀</div>
                    <div className="header-cell">group</div>
                    <div className="header-cell header-actions-cell">操作</div>
                </div>
                <div className="item-list">
                    {config.input.items.map((item, i) => (
                        <div className="item-row" key={i}>
                            <span className="item-index">{i + 1}</span>
                            <input className="capture" type="text" value={item.capture} placeholder="正则表达式，如 @Talk .*?name=(\S+)"
                                onChange={(e) => updateItem(i, { capture: e.target.value })} />
                            <input type="text" value={item.tag} placeholder="标签前缀，如 nme"
                                onChange={(e) => updateItem(i, { tag: e.target.value })} />
                            <input type="number" min="1" value={item.group} placeholder="group"
                                onChange={(e) => updateItem(i, { group: Number(e.target.value) || 1 })} />
                            <div className="item-actions">
                                <button className="ghost icon-button small" disabled={i === 0} onClick={() => moveItem(i, -1)}>↑</button>
                                <button className="ghost icon-button small" disabled={i === config.input.items.length - 1} onClick={() => moveItem(i, 1)}>↓</button>
                                <button className="ghost danger icon-button small" onClick={() => removeItem(i)}>×</button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="add-item-row">
                    <button className="ghost" type="button" onClick={addItem}>+ 添加提取项</button>
                </div>
            </div>

            <div className="form-section">
                <div className="form-section-title">输出</div>
                <div className="field">
                    <div className="field-label">输出路径</div>
                    <PathInput value={config.output.path} onChange={(v) => updateOutput({ path: v })} isDirectory placeholder="./output/" />
                </div>
                <div className="field">
                    <div className="field-label">输出编码</div>
                    <EncodingSelect value={config.output.encoding} onChange={(v) => updateOutput({ encoding: v })} />
                </div>
            </div>
        </div>
    );
}

function PackForm({ config, onChange, extractExt, onExtractExtChange }: {
    config: PackConfig; onChange: (c: PackConfig) => void; extractExt: string; onExtractExtChange: (v: string) => void;
}) {
    const updateInput = (patch: Partial<PackConfig['input']>) => onChange({ ...config, input: { ...config.input, ...patch } });
    const updateOutput = (patch: Partial<PackConfig['output']>) => onChange({ ...config, output: { ...config.output, ...patch } });
    return (
        <div>
            <div className="form-section">
                <div className="form-section-title">输入</div>
                <div className="field">
                    <div className="field-label">翻译文本路径</div>
                    <PathInput value={config.input.path} onChange={(v) => updateInput({ path: v })} isDirectory placeholder="./output/" />
                </div>
                <div className="field">
                    <div className="field-label">输入编码</div>
                    <EncodingSelect value={config.input.encoding} onChange={(v) => updateInput({ encoding: v })} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">输出</div>
                <div className="field">
                    <div className="field-label">替换后脚本输出路径</div>
                    <PathInput value={config.output.path} onChange={(v) => updateOutput({ path: v })} isDirectory placeholder="./replaced/" />
                </div>
                <div className="field">
                    <div className="field-label">输出编码</div>
                    <EncodingSelect value={config.output.encoding} onChange={(v) => updateOutput({ encoding: v })} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">关联提取配置</div>
                <div className="field">
                    <div className="field-label">原脚本后缀（需与提取时一致，空=无后缀）</div>
                    <input type="text" value={extractExt} placeholder="ks"
                        onChange={(e) => onExtractExtChange(e.target.value)} />
                    <div className="hint">打包需要知道原脚本后缀以定位 labelled 文件，请与「提取」tab 中的后缀保持一致。</div>
                </div>
            </div>
        </div>
    );
}

function ConcatForm({ config, onChange }: { config: ConcatConfig; onChange: (c: ConcatConfig) => void }) {
    const updateInput = (patch: Partial<ConcatConfig['input']>) => onChange({ ...config, input: { ...config.input, ...patch } });
    const updateOutput = (patch: Partial<ConcatConfig['output']>) => onChange({ ...config, output: { ...config.output, ...patch } });
    return (
        <div>
            <div className="form-section">
                <div className="form-section-title">输入</div>
                <div className="field">
                    <div className="field-label">输入路径（按子文件夹连接）</div>
                    <PathInput value={config.input.path} onChange={(v) => updateInput({ path: v })} isDirectory placeholder="./input-folder" />
                </div>
                <div className="field">
                    <div className="field-label">输入编码</div>
                    <EncodingSelect value={config.input.encoding} onChange={(v) => updateInput({ encoding: v })} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">输出</div>
                <div className="field">
                    <div className="field-label">输出路径</div>
                    <PathInput value={config.output.path} onChange={(v) => updateOutput({ path: v })} isDirectory placeholder="./concated" />
                </div>
                <div className="field">
                    <div className="field-label">输出编码</div>
                    <EncodingSelect value={config.output.encoding} onChange={(v) => updateOutput({ encoding: v })} />
                </div>
            </div>
        </div>
    );
}

function MergeForm({ config, onChange }: { config: MergeConfig; onChange: (c: MergeConfig) => void }) {
    const u1 = (p: Partial<MergeConfig['input1']>) => onChange({ ...config, input1: { ...config.input1, ...p } });
    const u2 = (p: Partial<MergeConfig['input2']>) => onChange({ ...config, input2: { ...config.input2, ...p } });
    const uo = (p: Partial<MergeConfig['output']>) => onChange({ ...config, output: { ...config.output, ...p } });
    return (
        <div>
            <div className="form-section">
                <div className="form-section-title">输入 1（原文）</div>
                <div className="field">
                    <div className="field-label">路径</div>
                    <PathInput value={config.input1.path} onChange={(v) => u1({ path: v })} isDirectory placeholder="./data_text" />
                </div>
                <div className="field">
                    <div className="field-label">编码</div>
                    <EncodingSelect value={config.input1.encoding} onChange={(v) => u1({ encoding: v })} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">输入 2（译文）</div>
                <div className="field">
                    <div className="field-label">路径</div>
                    <PathInput value={config.input2.path} onChange={(v) => u2({ path: v })} isDirectory placeholder="./chs_text" />
                </div>
                <div className="field">
                    <div className="field-label">编码</div>
                    <EncodingSelect value={config.input2.encoding} onChange={(v) => u2({ encoding: v })} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">输出</div>
                <div className="field">
                    <div className="field-label">输出路径</div>
                    <PathInput value={config.output.path} onChange={(v) => uo({ path: v })} isDirectory placeholder="./merge-output" />
                </div>
                <div className="field">
                    <div className="field-label">输出编码</div>
                    <EncodingSelect value={config.output.encoding} onChange={(v) => uo({ encoding: v })} />
                </div>
            </div>
        </div>
    );
}

function WordcountForm({ config, onChange }: { config: WordcountConfig; onChange: (c: WordcountConfig) => void }) {
    const updateInput = (patch: Partial<WordcountConfig['input']>) => onChange({ ...config, input: { ...config.input, ...patch } });
    return (
        <div className="form-section">
            <div className="form-section-title">输入</div>
            <div className="field">
                <div className="field-label">输入路径</div>
                <PathInput value={config.input.path} onChange={(v) => updateInput({ path: v })} isDirectory placeholder="./input-folder" />
            </div>
            <div className="field">
                <div className="field-label">输入编码</div>
                <EncodingSelect value={config.input.encoding} onChange={(v) => updateInput({ encoding: v })} />
            </div>
        </div>
    );
}

const TRANSFORM_PRESETS: Array<{ label: string; op: any }> = [
    { label: 'select @original', op: { select: '@original' } },
    { label: 'select @translation', op: { select: '@translation' } },
    { label: 'select @other', op: { select: '@other' } },
    { label: 'commit', op: { commit: '' } },
    { label: 'end-select', op: { 'end-select': '' } },
];

function TransformForm({ config, onChange }: { config: TransformConfig; onChange: (c: TransformConfig) => void }) {
    const [showHooks, setShowHooks] = useState(false);
    const update = (patch: Partial<TransformConfig>) => onChange({ ...config, ...patch });
    const updateOp = (i: number, op: any) => {
        const operations = config.operations.map((o, idx) => idx === i ? op : o);
        update({ operations });
    };
    const addOp = (op: any) => update({ operations: [...config.operations, op] });
    const removeOp = (i: number) => update({ operations: config.operations.filter((_, idx) => idx !== i) });

    return (
        <div>
            <div className="form-section">
                <div className="form-section-title">输入</div>
                <div className="field">
                    <div className="field-label">输入路径</div>
                    <PathInput value={config.input.path} onChange={(v) => update({ input: { ...config.input, path: v } })} isDirectory placeholder="./test" />
                </div>
                <div className="field">
                    <div className="field-label">输入编码</div>
                    <EncodingSelect value={config.input.encoding} onChange={(v) => update({ input: { ...config.input, encoding: v } })} />
                </div>
            </div>

            <div className="form-section">
                <div className="form-section-title">输出（可选）</div>
                <label className="checkbox-row">
                    <input type="checkbox" checked={!!config.output}
                        onChange={(e) => update({ output: e.target.checked ? { path: './transform-output', encoding: 'utf8' } : undefined })} />
                    启用输出
                </label>
                {config.output && (
                    <>
                        <div className="field">
                            <div className="field-label">输出路径</div>
                            <PathInput value={config.output.path} onChange={(v) => update({ output: { ...config.output!, path: v } })} isDirectory placeholder="./transform-output" />
                        </div>
                        <div className="field">
                            <div className="field-label">输出编码</div>
                            <EncodingSelect value={config.output.encoding || 'utf8'} onChange={(v) => update({ output: { ...config.output!, encoding: v } })} />
                        </div>
                    </>
                )}
            </div>

            <div className="form-section">
                <div className="form-section-title">脚本与模式</div>
                <div className="field">
                    <div className="field-label">脚本路径（可选，.js 文件）</div>
                    <PathInput value={config.script?.path || ''} onChange={(v) => update({ script: v ? { path: v } : undefined })} isDirectory={false} placeholder="./my-script.js" />
                </div>
                <div className="field">
                    <div className="field-label">处理模式</div>
                    <select value={config.mode} onChange={(e) => update({ mode: e.target.value as 'line' | 'block' })}>
                        <option value="line">逐行 (line)</option>
                        <option value="block">按双行块 (block)</option>
                    </select>
                </div>
            </div>

            <div className="form-section">
                <div className="form-section-title">操作列表</div>
                <div className="hint">按顺序执行。每个操作是一个对象，如 {`{ "select": "@translation" }`}。</div>
                <div className="item-list">
                    {config.operations.map((op, i) => (
                        <div className="item-row" key={i}>
                            <span className="item-index">{i + 1}</span>
                            <input type="text" value={JSON.stringify(op)}
                                onChange={(e) => {
                                    try { updateOp(i, JSON.parse(e.target.value)); } catch { /* ignore */ }
                                }} />
                            <div className="item-actions">
                                <button className="ghost danger icon-button small" onClick={() => removeOp(i)}>×</button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="add-item-row">
                    <select onChange={(e) => {
                        if (e.target.value) {
                            addOp(JSON.parse(e.target.value));
                            e.target.value = '';
                        }
                    }} value="">
                        <option value="">+ 添加预设...</option>
                        {TRANSFORM_PRESETS.map((p) => (
                            <option key={p.label} value={JSON.stringify(p.op)}>{p.label}</option>
                        ))}
                    </select>
                    <button className="ghost" type="button" onClick={() => addOp({ select: '' })}>+ 添加空操作</button>
                </div>
            </div>

            <div className="form-section">
                <button className="ghost" type="button" onClick={() => setShowHooks((v) => !v)}>
                    {showHooks ? '▾ 隐藏钩子' : '▸ 显示钩子（on-*）'}
                </button>
                {showHooks && (
                    <div style={{ marginTop: 10 }}>
                        {['on-global-begin', 'on-global-end', 'on-file-begin', 'on-file-end', 'on-text-block'].map((hook) => (
                            <div className="field" key={hook}>
                                <div className="field-label">{hook}</div>
                                <textarea value={(config as any)[hook] || ''} placeholder={`function ${hook}(ctx) { ... }`}
                                    onChange={(e) => update({ [hook]: e.target.value })} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ---- 主组件 ----

interface StatusState { kind: 'idle' | 'running' | 'success' | 'error'; text: string }

function App() {
    const [activeTab, setActiveTab] = useState<TabId>('extract');
    const [extractConfig, setExtractConfig] = useState<ExtractConfig>(defaultExtract);
    const [packConfig, setPackConfig] = useState<PackConfig>(defaultPack);
    const [concatConfig, setConcatConfig] = useState<ConcatConfig>(defaultConcat);
    const [mergeConfig, setMergeConfig] = useState<MergeConfig>(defaultMerge);
    const [wordcountConfig, setWordcountConfig] = useState<WordcountConfig>(defaultWordcount);
    const [transformConfig, setTransformConfig] = useState<TransformConfig>(defaultTransform);
    const [extractExt, setExtractExt] = useState('ks');
    const [status, setStatus] = useState<StatusState>({ kind: 'idle', text: '就绪' });
    const [running, setRunning] = useState(false);

    const pendingRef = useRef<Map<string, { resolve: (p: any) => void; reject: (e: string) => void }>>(new Map());

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data;
            if (!msg || !msg.requestId) { return; }
            const pending = pendingRef.current.get(msg.requestId);
            if (!pending) { return; }
            pendingRef.current.delete(msg.requestId);
            if (msg.type === 'requestError') {
                pending.reject(msg.error || '未知错误');
            } else {
                pending.resolve(msg);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    function request<T>(type: string, payload: Record<string, unknown>): Promise<T> {
        const requestId = uid(type);
        return new Promise((resolve, reject) => {
            pendingRef.current.set(requestId, { resolve: (p) => resolve(p as T), reject });
            vscode.postMessage({ type, requestId, ...payload });
        });
    }

    function getActiveConfig(): any {
        switch (activeTab) {
            case 'extract': return extractConfig;
            case 'pack': return { pack: packConfig, extractExt };
            case 'concat': return concatConfig;
            case 'merge': return mergeConfig;
            case 'wordcount': return wordcountConfig;
            case 'transform': return transformConfig;
        }
    }

    async function handleValidate() {
        try {
            const res = await request<{ ok: boolean; error?: string }>('validateConfig', {
                activeTab,
                config: getActiveConfig(),
            });
            if (res.ok) {
                setStatus({ kind: 'success', text: '✓ 配置有效' });
            } else {
                setStatus({ kind: 'error', text: `✗ ${res.error || '配置无效'}` });
            }
        } catch (e: any) {
            setStatus({ kind: 'error', text: `✗ ${e}` });
        }
    }

    async function handleRun() {
        setRunning(true);
        setStatus({ kind: 'running', text: '执行中...' });
        try {
            const res = await request<{ ok: boolean; message: string; total?: number; success?: number }>('runOperation', {
                activeTab,
                config: getActiveConfig(),
            });
            if (res.ok) {
                setStatus({ kind: 'success', text: `✓ ${res.message}` });
            } else {
                setStatus({ kind: 'error', text: `✗ ${res.message}` });
            }
        } catch (e: any) {
            setStatus({ kind: 'error', text: `✗ ${e}` });
        } finally {
            setRunning(false);
        }
    }

    return (
        <div className="app">
            <div className="tabbar">
                {TABS.map((tab) => (
                    <button key={tab.id}
                        className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}>
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="form-panel">
                {activeTab === 'extract' && <ExtractConfigForm config={extractConfig} onChange={setExtractConfig} />}
                {activeTab === 'pack' && <PackForm config={packConfig} onChange={setPackConfig} extractExt={extractExt} onExtractExtChange={setExtractExt} />}
                {activeTab === 'concat' && <ConcatForm config={concatConfig} onChange={setConcatConfig} />}
                {activeTab === 'merge' && <MergeForm config={mergeConfig} onChange={setMergeConfig} />}
                {activeTab === 'wordcount' && <WordcountForm config={wordcountConfig} onChange={setWordcountConfig} />}
                {activeTab === 'transform' && <TransformForm config={transformConfig} onChange={setTransformConfig} />}
            </div>

            <div className="toolbar">
                <div className="toolbar-left">
                    <button className="ghost" type="button" onClick={handleValidate} disabled={running}>验证配置</button>
                </div>
                <div className="toolbar-right">
                    <button type="button" onClick={handleRun} disabled={running}>
                        {running ? '执行中...' : '执行当前操作'}
                    </button>
                </div>
            </div>

            <div className={`statusbar ${status.kind}`}>
                <span className="status-icon">
                    {status.kind === 'success' ? '✓' : status.kind === 'error' ? '✗' : status.kind === 'running' ? '⟳' : '•'}
                </span>
                <span>{status.text}</span>
            </div>
        </div>
    );
}

// 别名避免名称冲突
function ExtractConfigForm(props: { config: ExtractConfig; onChange: (c: ExtractConfig) => void }) {
    return <ExtractForm {...props} />;
}

const rootElement = document.getElementById('view-root');
if (rootElement) {
    createRoot(rootElement).render(<App />);
}
