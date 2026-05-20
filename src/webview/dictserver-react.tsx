import { React, createRoot } from './react-shared-runtime';

interface DictExample {
	id: string;
	title: string;
	trans: string;
}

interface DictSubDetail {
	id: string;
	title: string;
	detailId: string;
	examples: DictExample[];
}

interface DictWord {
	id: string;
	spell: string;
	pron: string;
	accent: string;
	excerpt: string;
	subDetails: DictSubDetail[];
}

interface DictPayload {
	words: DictWord[];
}

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

function parseNumericId(value: string): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? 0 : parsed;
}

const content = parseJsonElement<DictPayload>('raw-data', { words: [] });

function WordCard({ word }: { word: DictWord }) {
	const subDetails = Array.isArray(word.subDetails)
		? [...word.subDetails].sort((left, right) => parseNumericId(left.id) - parseNumericId(right.id))
		: [];

	return (
		<div className="dict-word dict-widget">
			<p className="dict-widget">{word.spell}</p>
			<p className="dict-widget">{word.pron}</p>
			<p className="dict-widget">{word.accent}</p>
			<p className="dict-widget">{word.excerpt}</p>
			{subDetails.map((subDetail) => (
				<div key={`${word.spell}-${subDetail.id}`} className="sub-detail dict-widget">
					<p
						className="dict-widget"
						style={subDetail.examples.length > 0 ? { paddingBottom: '15px', borderBottom: '1px solid' } : undefined}
					>
						释义：{subDetail.title}
					</p>
					{subDetail.examples.map((example, index) => (
						<div key={`${subDetail.id}-${index}`} className="example dict-widget">
							<p>例句: {example.title}</p>
							<p>翻译: {example.trans}</p>
						</div>
					))}
				</div>
			))}
		</div>
	);
}

function App() {
	const words = Array.isArray(content.words) ? content.words : [];
	return <>{words.map((word, index) => <WordCard key={`${word.spell}-${index}`} word={word} />)}</>;
}

const rootElement = document.getElementById('view-root');
if (rootElement) {
	createRoot(rootElement).render(<App />);
}