import { React, createRoot } from './react-shared-runtime';

const rawDataElement = document.getElementById('raw-data');
const content = rawDataElement ? JSON.parse(rawDataElement.textContent || '{"words":[]}') : { words: [] };

function WordCard({ word }) {
  const subDetails = Array.isArray(word.subDetails) ? [...word.subDetails].sort((left, right) => left.id - right.id) : [];

  return (
    <div className="dict-word dict-widget">
      <p className="dict-widget">{word.spell}</p>
      <p className="dict-widget">{word.pron}</p>
      <p className="dict-widget">{word.accent}</p>
      <p className="dict-widget">{word.excerpt}</p>
      {subDetails.map((subDetail) => (
        <div key={`${word.spell}-${subDetail.id}`} className="sub-detail dict-widget">
          <p className="dict-widget" style={subDetail.examples?.length > 0 ? { paddingBottom: '15px', borderBottom: '1px solid' } : undefined}>
            释义：{subDetail.title}
          </p>
          {(subDetail.examples || []).map((example, index) => (
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
