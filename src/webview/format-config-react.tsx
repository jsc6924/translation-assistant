import { React, createRoot, useState } from './react-shared-runtime';

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

const vscode = acquireVsCodeApi();
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

function createChoiceLabelId(index: number): string {
	return `choice-${index}`;
}

const initialState = parseJsonElement<FormatConfigState>('format-config-state', {});

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
			}
		});
	}

	return (
		<div className="container">
			<div className="section">
				<h2>格式化选项</h2>
				<div className="option-list">
					{choices.map((choice, index) => {
						const labelId = createChoiceLabelId(index);
						return (
							<div key={choice.configKey} className="option-row">
								<div className="option-main">
									<input
										id={labelId}
										type="checkbox"
										checked={!!choice.enabled}
										onChange={(event) => updateChoice(index, { enabled: event.target.checked })}
									/>
									<label htmlFor={labelId}>{choice.label}</label>
								</div>
								{choice.specifyKey && Array.isArray(choice.specifyOptions) ? (
									<select
										className="option-select"
										value={choice.specifiedValue || choice.specifyOptions[0]}
										disabled={!choice.enabled}
										onChange={(event) => updateChoice(index, { specifiedValue: event.target.value })}
									>
										{choice.specifyOptions.map((option) => (
											<option key={option} value={option}>{option}</option>
										))}
									</select>
								) : (
									<div />
								)}
							</div>
						);
					})}
				</div>
			</div>
			<div className="section">
				<h2>空格规则</h2>
				<div className="two-column">
					<div className="field">
						<label htmlFor="space-after-qe">在问号、感叹号后的空格</label>
						<select id="space-after-qe" className="config-select" value={spaceAfterQE} onChange={(event) => setSpaceAfterQE(event.target.value)}>
							{spaceOptions.map((option) => (
								<option key={option} value={option}>{option}</option>
							))}
						</select>
					</div>
					<div className="field">
						<label htmlFor="space-after-newline">在对话换行符后的空格</label>
						<select id="space-after-newline" className="config-select" value={spaceAfterNewline} onChange={(event) => setSpaceAfterNewline(event.target.value)}>
							{spaceOptions.map((option) => (
								<option key={option} value={option}>{option}</option>
							))}
						</select>
					</div>
				</div>
			</div>
			<div className="section">
				<h2>换行设置</h2>
				<div className="two-column">
					<div className="field">
						<label htmlFor="newline-token">换行符</label>
						<input id="newline-token" className="config-input" type="text" value={newlineToken} onChange={(event) => setNewlineToken(event.target.value)} />
					</div>
					<div className="field">
						<label htmlFor="newline-max-len">单行最大长度</label>
						<input id="newline-max-len" className="config-input" type="number" min="1" step="1" value={newlineMaxLen} onChange={(event) => setNewlineMaxLen(event.target.value)} />
					</div>
				</div>
			</div>
			<div className="actions">
				<button className="secondary" type="button" onClick={() => vscode.postMessage({ type: 'config-cancel' })}>取消</button>
				<button className="primary" type="button" onClick={handleSubmit}>提交</button>
			</div>
		</div>
	);
}

const rootElement = document.getElementById('view-root');
if (rootElement) {
	createRoot(rootElement).render(<App />);
}