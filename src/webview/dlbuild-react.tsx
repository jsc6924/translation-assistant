import { React, createRoot, useState } from './react-shared-runtime';
import { Button } from './components/Button';
import { TextField } from './components/TextField';
import { Select } from './components/Select';
import { Checkbox } from './components/Checkbox';
import { PathInput } from './components/PathInput';
import { useVscodeRpc } from './useVscodeRpc';
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

const ENCODINGS = [
    'auto', 'utf8', 'utf8-bom', 'utf16le', 'utf16le-bom',
    'utf16be', 'utf16be-bom', 'shift-jis', 'gb2312', 'gbk',
];

const ENCODING_OPTIONS = ENCODINGS.map((enc) => ({ value: enc, label: enc }));

interface InitialState { rootPath: string }

function parseJsonElement<T>(elementId: string, fallback: T): T {
    const el = document.getElementById(elementId);
    if (!el?.textContent) { return fallback; }
    try { return JSON.parse(el.textContent) as T; } catch { return fallback; }
}

const initialState = parseJsonElement<InitialState>('initial-state', { rootPath: '' });

// ---- 各表单初始值 ----

function defaultExtract(): ExtractConfig {
    return {
        input: {
            path: './input/',
            encoding: 'shift-jis',
            ext: 'ks',
            digits: 5,
            items: [{ capture: '@Talk .*?name=(\\S+)', tag: 'nme', group: 1 }],
        },
        output: { path: './output/', encoding: 'utf16le-bom' },
    };
}

function defaultPack(): PackConfig {
    return {
        input: { path: './output/', encoding: 'utf16le-bom' },
        output: { path: './replaced/', encoding: 'utf16le-bom' },
    };
}

function defaultConcat(): ConcatConfig {
    return {
        input: { path: './input-folder', encoding: 'auto' },
        output: { path: './concated', encoding: 'utf16le-bom' },
    };
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

function ExtractForm({ config, onChange, rootPath }: {
    config: ExtractConfig; onChange: (c: ExtractConfig) => void; rootPath: string;
}) {
    const updateInput = (patch: Partial<ExtractConfig['input']>) =>
        onChange({ ...config, input: { ...config.input, ...patch } });
    const updateOutput = (patch: Partial<ExtractConfig['output']>) =>
        onChange({ ...config, output: { ...config.output, ...patch } });
    const updateItem = (i: number, patch: Partial<ExtractConfig['input']['items'][0]>) => {
        const items = config.input.items.map((it, idx) => idx === i ? { ...it, ...patch } : it);
        updateInput({ items });
    };
    const addItem = () => updateInput({
        items: [...config.input.items, { capture: '', tag: '', group: 1 }],
    });
    const removeItem = (i: number) => updateInput({
        items: config.input.items.filter((_, idx) => idx !== i),
    });
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
                    <PathInput value={config.input.path}
                        onChange={(v) => updateInput({ path: v })}
                        rootPath={rootPath} placeholder="./input/" />
                </div>
                <div className="two-col">
                    <div className="field">
                        <div className="field-label">输入编码</div>
                        <Select value={config.input.encoding}
                            onChange={(v) => updateInput({ encoding: v })}
                            options={ENCODING_OPTIONS} />
                    </div>
                    <div className="field">
                        <div className="field-label">文件后缀（空=全部）</div>
                        <TextField value={config.input.ext}
                            onChange={(v) => updateInput({ ext: v })} placeholder="ks" />
                    </div>
                </div>
                <div className="field">
                    <div className="field-label">标签数字位数</div>
                    <TextField type="number" min={1} value={String(config.input.digits)}
                        onChange={(v) => updateInput({ digits: Number(v) || 1 })} />
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
                            <TextField className="capture" value={item.capture}
                                onChange={(v) => updateItem(i, { capture: v })}
                                placeholder="正则表达式，如 @Talk .*?name=(\S+)" />
                            <TextField value={item.tag}
                                onChange={(v) => updateItem(i, { tag: v })}
                                placeholder="标签前缀，如 nme" />
                            <TextField type="number" min={1} value={String(item.group)}
                                onChange={(v) => updateItem(i, { group: Number(v) || 1 })} />
                            <div className="item-actions">
                                <Button size="icon-sm" variant="ghost"
                                    disabled={i === 0} onClick={() => moveItem(i, -1)}>↑</Button>
                                <Button size="icon-sm" variant="ghost"
                                    disabled={i === config.input.items.length - 1} onClick={() => moveItem(i, 1)}>↓</Button>
                                <Button size="icon-sm" variant="danger" onClick={() => removeItem(i)}>×</Button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="add-item-row">
                    <Button variant="ghost" onClick={addItem}>+ 添加提取项</Button>
                </div>
            </div>

            <div className="form-section">
                <div className="form-section-title">输出</div>
                <div className="field">
                    <div className="field-label">输出路径</div>
                    <PathInput value={config.output.path}
                        onChange={(v) => updateOutput({ path: v })}
                        rootPath={rootPath} placeholder="./output/" />
                </div>
                <div className="field">
                    <div className="field-label">输出编码</div>
                    <Select value={config.output.encoding}
                        onChange={(v) => updateOutput({ encoding: v })}
                        options={ENCODING_OPTIONS} />
                </div>
            </div>
        </div>
    );
}

function PackForm({ config, onChange, extractExt, onExtractExtChange, rootPath }: {
    config: PackConfig; onChange: (c: PackConfig) => void;
    extractExt: string; onExtractExtChange: (v: string) => void; rootPath: string;
}) {
    const updateInput = (patch: Partial<PackConfig['input']>) =>
        onChange({ ...config, input: { ...config.input, ...patch } });
    const updateOutput = (patch: Partial<PackConfig['output']>) =>
        onChange({ ...config, output: { ...config.output, ...patch } });
    return (
        <div>
            <div className="form-section">
                <div className="form-section-title">输入</div>
                <div className="field">
                    <div className="field-label">翻译文本路径</div>
                    <PathInput value={config.input.path}
                        onChange={(v) => updateInput({ path: v })}
                        rootPath={rootPath} placeholder="./output/" />
                </div>
                <div className="field">
                    <div className="field-label">输入编码</div>
                    <Select value={config.input.encoding}
                        onChange={(v) => updateInput({ encoding: v })}
                        options={ENCODING_OPTIONS} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">输出</div>
                <div className="field">
                    <div className="field-label">替换后脚本输出路径</div>
                    <PathInput value={config.output.path}
                        onChange={(v) => updateOutput({ path: v })}
                        rootPath={rootPath} placeholder="./replaced/" />
                </div>
                <div className="field">
                    <div className="field-label">输出编码</div>
                    <Select value={config.output.encoding}
                        onChange={(v) => updateOutput({ encoding: v })}
                        options={ENCODING_OPTIONS} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">关联提取配置</div>
                <div className="field">
                    <div className="field-label">原脚本后缀（需与提取时一致，空=无后缀）</div>
                    <TextField value={extractExt} onChange={onExtractExtChange} placeholder="ks" />
                    <div className="hint">打包需要知道原脚本后缀以定位 labelled 文件，请与「提取」tab 中的后缀保持一致。</div>
                </div>
            </div>
        </div>
    );
}

function ConcatForm({ config, onChange, rootPath }: {
    config: ConcatConfig; onChange: (c: ConcatConfig) => void; rootPath: string;
}) {
    const updateInput = (patch: Partial<ConcatConfig['input']>) =>
        onChange({ ...config, input: { ...config.input, ...patch } });
    const updateOutput = (patch: Partial<ConcatConfig['output']>) =>
        onChange({ ...config, output: { ...config.output, ...patch } });
    return (
        <div>
            <div className="form-section">
                <div className="form-section-title">输入</div>
                <div className="field">
                    <div className="field-label">输入路径（按子文件夹连接）</div>
                    <PathInput value={config.input.path}
                        onChange={(v) => updateInput({ path: v })}
                        rootPath={rootPath} placeholder="./input-folder" />
                </div>
                <div className="field">
                    <div className="field-label">输入编码</div>
                    <Select value={config.input.encoding}
                        onChange={(v) => updateInput({ encoding: v })}
                        options={ENCODING_OPTIONS} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">输出</div>
                <div className="field">
                    <div className="field-label">输出路径</div>
                    <PathInput value={config.output.path}
                        onChange={(v) => updateOutput({ path: v })}
                        rootPath={rootPath} placeholder="./concated" />
                </div>
                <div className="field">
                    <div className="field-label">输出编码</div>
                    <Select value={config.output.encoding}
                        onChange={(v) => updateOutput({ encoding: v })}
                        options={ENCODING_OPTIONS} />
                </div>
            </div>
        </div>
    );
}

function MergeForm({ config, onChange, rootPath }: {
    config: MergeConfig; onChange: (c: MergeConfig) => void; rootPath: string;
}) {
    const u1 = (p: Partial<MergeConfig['input1']>) =>
        onChange({ ...config, input1: { ...config.input1, ...p } });
    const u2 = (p: Partial<MergeConfig['input2']>) =>
        onChange({ ...config, input2: { ...config.input2, ...p } });
    const uo = (p: Partial<MergeConfig['output']>) =>
        onChange({ ...config, output: { ...config.output, ...p } });
    return (
        <div>
            <div className="form-section">
                <div className="form-section-title">输入 1（原文）</div>
                <div className="field">
                    <div className="field-label">路径</div>
                    <PathInput value={config.input1.path}
                        onChange={(v) => u1({ path: v })}
                        rootPath={rootPath} placeholder="./data_text" />
                </div>
                <div className="field">
                    <div className="field-label">编码</div>
                    <Select value={config.input1.encoding}
                        onChange={(v) => u1({ encoding: v })}
                        options={ENCODING_OPTIONS} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">输入 2（译文）</div>
                <div className="field">
                    <div className="field-label">路径</div>
                    <PathInput value={config.input2.path}
                        onChange={(v) => u2({ path: v })}
                        rootPath={rootPath} placeholder="./chs_text" />
                </div>
                <div className="field">
                    <div className="field-label">编码</div>
                    <Select value={config.input2.encoding}
                        onChange={(v) => u2({ encoding: v })}
                        options={ENCODING_OPTIONS} />
                </div>
            </div>
            <div className="form-section">
                <div className="form-section-title">输出</div>
                <div className="field">
                    <div className="field-label">输出路径</div>
                    <PathInput value={config.output.path}
                        onChange={(v) => uo({ path: v })}
                        rootPath={rootPath} placeholder="./merge-output" />
                </div>
                <div className="field">
                    <div className="field-label">输出编码</div>
                    <Select value={config.output.encoding}
                        onChange={(v) => uo({ encoding: v })}
                        options={ENCODING_OPTIONS} />
                </div>
            </div>
        </div>
    );
}

function WordcountForm({ config, onChange, rootPath }: {
    config: WordcountConfig; onChange: (c: WordcountConfig) => void; rootPath: string;
}) {
    const updateInput = (patch: Partial<WordcountConfig['input']>) =>
        onChange({ ...config, input: { ...config.input, ...patch } });
    return (
        <div className="form-section">
            <div className="form-section-title">输入</div>
            <div className="field">
                <div className="field-label">输入路径</div>
                <PathInput value={config.input.path}
                    onChange={(v) => updateInput({ path: v })}
                    rootPath={rootPath} placeholder="./input-folder" />
            </div>
            <div className="field">
                <div className="field-label">输入编码</div>
                <Select value={config.input.encoding}
                    onChange={(v) => updateInput({ encoding: v })}
                    options={ENCODING_OPTIONS} />
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

const TRANSFORM_PRESET_OPTIONS = TRANSFORM_PRESETS.map((p) => ({
    value: JSON.stringify(p.op), label: p.label,
}));

const TRANSFORM_MODE_OPTIONS = [
    { value: 'line', label: '逐行 (line)' },
    { value: 'block', label: '按双行块 (block)' },
];

function TransformForm({ config, onChange, rootPath }: {
    config: TransformConfig; onChange: (c: TransformConfig) => void; rootPath: string;
}) {
    const [showHooks, setShowHooks] = useState(false);
    const update = (patch: Partial<TransformConfig>) => onChange({ ...config, ...patch });
    const updateOp = (i: number, op: any) => {
        const operations = config.operations.map((o, idx) => idx === i ? op : o);
        update({ operations });
    };
    const addOp = (op: any) => update({ operations: [...config.operations, op] });
    const removeOp = (i: number) => update({
        operations: config.operations.filter((_, idx) => idx !== i),
    });

    return (
        <div>
            <div className="form-section">
                <div className="form-section-title">输入</div>
                <div className="field">
                    <div className="field-label">输入路径</div>
                    <PathInput value={config.input.path}
                        onChange={(v) => update({ input: { ...config.input, path: v } })}
                        rootPath={rootPath} placeholder="./test" />
                </div>
                <div className="field">
                    <div className="field-label">输入编码</div>
                    <Select value={config.input.encoding}
                        onChange={(v) => update({ input: { ...config.input, encoding: v } })}
                        options={ENCODING_OPTIONS} />
                </div>
            </div>

            <div className="form-section">
                <div className="form-section-title">输出（可选）</div>
                <Checkbox checked={!!config.output} label="启用输出"
                    onChange={(checked) => update({
                        output: checked
                            ? { path: './transform-output', encoding: 'utf8' }
                            : undefined,
                    })} />
                {config.output && (
                    <>
                        <div className="field">
                            <div className="field-label">输出路径</div>
                            <PathInput value={config.output.path}
                                onChange={(v) => update({ output: { ...config.output!, path: v } })}
                                rootPath={rootPath} placeholder="./transform-output" />
                        </div>
                        <div className="field">
                            <div className="field-label">输出编码</div>
                            <Select value={config.output.encoding || 'utf8'}
                                onChange={(v) => update({ output: { ...config.output!, encoding: v } })}
                                options={ENCODING_OPTIONS} />
                        </div>
                    </>
                )}
            </div>

            <div className="form-section">
                <div className="form-section-title">脚本与模式</div>
                <div className="field">
                    <div className="field-label">脚本路径（可选，.js 文件）</div>
                    <PathInput value={config.script?.path || ''}
                        onChange={(v) => update({ script: v ? { path: v } : undefined })}
                        rootPath={rootPath} isDirectory={false} placeholder="./my-script.js" />
                </div>
                <div className="field">
                    <div className="field-label">处理模式</div>
                    <Select value={config.mode}
                        onChange={(v) => update({ mode: v as 'line' | 'block' })}
                        options={TRANSFORM_MODE_OPTIONS} />
                </div>
            </div>

            <div className="form-section">
                <div className="form-section-title">操作列表</div>
                <div className="hint">按顺序执行。每个操作是一个对象，如 {`{ "select": "@translation" }`}。</div>
                <div className="item-list">
                    {config.operations.map((op, i) => (
                        <div className="item-row" key={i}>
                            <span className="item-index">{i + 1}</span>
                            <TextField value={JSON.stringify(op)}
                                onChange={(v) => {
                                    try { updateOp(i, JSON.parse(v)); } catch { /* ignore */ }
                                }} />
                            <div className="item-actions">
                                <Button size="icon-sm" variant="danger" onClick={() => removeOp(i)}>×</Button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="add-item-row">
                    <Select value="" ariaLabel="添加预设"
                        onChange={(v) => {
                            if (v) {
                                try { addOp(JSON.parse(v)); } catch { /* ignore */ }
                            }
                        }}
                        options={[{ value: '', label: '+ 添加预设...' }, ...TRANSFORM_PRESET_OPTIONS]} />
                    <Button variant="ghost" onClick={() => addOp({ select: '' })}>+ 添加空操作</Button>
                </div>
            </div>

            <div className="form-section">
                <Button variant="ghost" onClick={() => setShowHooks((v) => !v)}>
                    {showHooks ? '▾ 隐藏钩子' : '▸ 显示钩子（on-*）'}
                </Button>
                {showHooks && (
                    <div style={{ marginTop: 10 }}>
                        {(['on-global-begin', 'on-global-end', 'on-file-begin', 'on-file-end', 'on-text-block'] as const).map((hook) => (
                            <div className="field" key={hook}>
                                <div className="field-label">{hook}</div>
                                <textarea value={(config as any)[hook] || ''}
                                    placeholder={`function ${hook}(ctx) { ... }`}
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
    const rpc = useVscodeRpc();

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
            const res = await rpc.request<{ ok: boolean; error?: string }>('validateConfig', {
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
            const res = await rpc.request<{ ok: boolean; message: string; total?: number; success?: number }>('runOperation', {
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

    const rootPath = initialState.rootPath;

    return (
        <div className="app">
            <div className="tabbar">
                {TABS.map((tab) => (
                    <Button key={tab.id}
                        className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}>
                        {tab.label}
                    </Button>
                ))}
            </div>

            <div className="form-panel">
                {activeTab === 'extract' &&
                    <ExtractForm config={extractConfig} onChange={setExtractConfig} rootPath={rootPath} />}
                {activeTab === 'pack' &&
                    <PackForm config={packConfig} onChange={setPackConfig}
                        extractExt={extractExt} onExtractExtChange={setExtractExt}
                        rootPath={rootPath} />}
                {activeTab === 'concat' &&
                    <ConcatForm config={concatConfig} onChange={setConcatConfig} rootPath={rootPath} />}
                {activeTab === 'merge' &&
                    <MergeForm config={mergeConfig} onChange={setMergeConfig} rootPath={rootPath} />}
                {activeTab === 'wordcount' &&
                    <WordcountForm config={wordcountConfig} onChange={setWordcountConfig} rootPath={rootPath} />}
                {activeTab === 'transform' &&
                    <TransformForm config={transformConfig} onChange={setTransformConfig} rootPath={rootPath} />}
            </div>

            <div className="toolbar">
                <div className="toolbar-left">
                    <Button variant="ghost" onClick={handleValidate} disabled={running}>
                        验证配置
                    </Button>
                </div>
                <div className="toolbar-right">
                    <Button onClick={handleRun} disabled={running}>
                        {running ? '执行中...' : '执行当前操作'}
                    </Button>
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

const rootElement = document.getElementById('view-root');
if (rootElement) {
    createRoot(rootElement).render(<App />);
}
