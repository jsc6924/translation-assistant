import { React, createRoot } from './react-shared-runtime';

interface TranslationResult {
	id: string;
	fileName: string;
	jpLines: string[];
	trLines: string[];
}

interface TranslationPayload {
	results: TranslationResult[];
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

const content = parseJsonElement<TranslationPayload>('raw-data', { results: [] });

function ResultCard({ result }: { result: TranslationResult }) {
	const pairs = Array.isArray(result.jpLines)
		? result.jpLines.map((jp, index) => ({
			jp,
			tr: result.trLines[index] || '',
		}))
		: [];

	return (
		<div className="example dict-widget">
			<div className="example-title" style={{ textAlign: 'center' }}>
				{result.id}: {result.fileName}
			</div>
			{pairs.map((pair, index) => (
				<div key={`${result.id}-${index}`} className="sentence-pair dict-widget">
					{pair.jp}
					<br />
					{pair.tr}
				</div>
			))}
		</div>
	);
}

function App() {
	const results = Array.isArray(content.results) ? content.results : [];
	return <>{results.map((result) => <ResultCard key={result.id} result={result} />)}</>;
}

const rootElement = document.getElementById('view-root');
if (rootElement) {
	createRoot(rootElement).render(<App />);
}