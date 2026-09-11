import { React, createRoot, useState } from './react-shared-runtime';
import { Button } from './components/Button';
import { TextField } from './components/TextField';
import { Select } from './components/Select';
import { Checkbox } from './components/Checkbox';
import { vscode } from './vscode';

interface FormatChoice {
    configKey: string;
    label: string;
    enabled?: boolean;
    specifyKey?: string;
    specifiedValue?: string;
    specifyOptions?: string[];
}

interface FormatConfigState {
    choices?: FormatChoice[];
    spaceAfterQE?: string;
    spaceAfterNewline?: string;
    newlineToken?: string;
    newlineMaxLen?: number;
}

const spaceOptions = ['无效', '添加空格', '删除空格'];

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

const initialState = parseJsonElement<FormatConfigState>('format-config-state', {});

const SPACE_OPTIONS = spaceOptions.map((value) => ({ value, label: value }));

function App() {
    const [choices, setChoices] = useState<FormatChoice[]>(() => Array.isArray(initialState.choices) ? initialState.choices : []);
    const [spaceAfterQE, setSpaceAfterQE] = useState(initialState.spaceAfterQE || '无效');
    const [spaceAfterNewline, setSpaceAfterNewline] = useState(initialState.spaceAfterNewline || '无效');
    const [newlineToken, setNewlineToken] = useState(initialState.newlineToken || '');
    const [newlineMaxLen, setNewlineMaxLen] = useState(String(initialState.newlineMaxLen || 24));

    function updateChoice(index: number, patch: Partial<FormatChoice>) {
        setChoices((currentChoices) => currentChoices.map((choice, currentIndex) => (
            currentIndex === index ? { ...choice, ...patch } : choice
        )));
    }

    function handleSubmit() {
        vscode.postMessage({
            type: 'config-submit',
            payload: {
                choices: choices.map((choice) => ({
                    configKey: choice.configKey,
                    enabled: !!choice.enabled,
                    specifyKey: choice.specifyKey,
                    specifyValue: choice.specifyKey ? choice.specifiedValue : undefined,
                })),
                newlineToken,
                newlineMaxLen: Number.parseInt(newlineMaxLen, 10),
                spaceAfterQE,
                spaceAfterNewline,
            },
        });
    }

    return (
        <div className="container">
            <div className="section">
                <h2>格式化选项</h2>
                <div className="option-list">
                    {choices.map((choice, index) => (
                        <div key={choice.configKey} className="option-row">
                            <div className="option-main">
                                <Checkbox
                                    checked={!!choice.enabled}
                                    onChange={(checked) => updateChoice(index, { enabled: checked })}
                                    ariaLabel={choice.label} />
                                <label>{choice.label}</label>
                            </div>
                            {choice.specifyKey && Array.isArray(choice.specifyOptions) ? (
                                <Select
                                    className="option-select"
                                    value={choice.specifiedValue || choice.specifyOptions[0]}
                                    disabled={!choice.enabled}
                                    onChange={(v) => updateChoice(index, { specifiedValue: v })}
                                    options={choice.specifyOptions.map((o) => ({ value: o, label: o }))} />
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
            <div className="section">
                <h2>空格规则</h2>
                <div className="two-column">
                    <div className="field">
                        <label htmlFor="space-after-qe">在问号、感叹号后的空格</label>
                        <Select className="config-select"
                            value={spaceAfterQE}
                            onChange={setSpaceAfterQE}
                            options={SPACE_OPTIONS} />
                    </div>
                    <div className="field">
                        <label htmlFor="space-after-newline">在对话换行符后的空格</label>
                        <Select className="config-select"
                            value={spaceAfterNewline}
                            onChange={setSpaceAfterNewline}
                            options={SPACE_OPTIONS} />
                    </div>
                </div>
            </div>
            <div className="section">
                <h2>换行设置</h2>
                <div className="two-column">
                    <div className="field">
                        <label htmlFor="newline-token">换行符</label>
                        <TextField className="config-input" value={newlineToken} onChange={setNewlineToken} />
                    </div>
                    <div className="field">
                        <label htmlFor="newline-max-len">单行最大长度</label>
                        <TextField className="config-input" type="number" min={1} step={1}
                            value={newlineMaxLen} onChange={setNewlineMaxLen} />
                    </div>
                </div>
            </div>
            <div className="actions">
                <Button variant="ghost" onClick={() => vscode.postMessage({ type: 'config-cancel' })}>取消</Button>
                <Button onClick={handleSubmit}>提交</Button>
            </div>
        </div>
    );
}

const rootElement = document.getElementById('view-root');
if (rootElement) {
    createRoot(rootElement).render(<App />);
}
