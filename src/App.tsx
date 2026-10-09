import { useState, useMemo } from 'preact/hooks';
import { marked } from 'marked';
import { highlightEtymology } from './highlighter';
import type { EtymologyOrigin } from './etymologyDict';
import { ORIGIN_LABELS } from './origins';
import { SynonymPanel } from './SynonymPanel';

const DEFAULT_TEXT = `# Etymology Highlighter

Type some text here to see words colored by their etymological origin.

The **sky** is blue and the **government** passes **justice** for every **child**.

Study **philosophy** and **democracy** — observe each **animal** and drink the **water**.

Click any word to find its synonyms, grouped by origin — a Greek **hypodermic** has a Latin twin.
`;

const LEGEND: EtymologyOrigin[] = [
	'latin',
	'greek',
	'anglo-saxon',
	'old-norse',
	'french',
	'germanic',
];

export default function App() {
	const [text, setText] = useState(DEFAULT_TEXT);
	const [synonymWord, setSynonymWord] = useState<string | null>(null);

	const highlightedHtml = useMemo(() => {
		const rawHtml = marked.parse(text, { async: false }) as string;
		return highlightEtymology(rawHtml);
	}, [text]);

	return (
		<div class="app">
			<header class="header">
				<h1>Etymology Highlighter</h1>
				<div class="legend">
					{LEGEND.map((origin) => (
						<span key={origin} class={`legend-item etym-${origin}`}>
							{ORIGIN_LABELS[origin]}
						</span>
					))}
				</div>
			</header>
			<div class="split-pane">
				<textarea
					class="editor-pane"
					value={text}
					onInput={(e) => setText(e.currentTarget.value)}
					spellcheck={false}
				/>
				<div
					class="preview-pane"
					dangerouslySetInnerHTML={{ __html: highlightedHtml }}
					onClick={(e) => {
						// Each highlighted word is a <span class="etym-…"> (see highlighter.ts)
						const span = (e.target as Element).closest('span[class^="etym-"]');
						const word = span?.textContent?.replace(/^['-]+|['-]+$/g, '');
						if (word) setSynonymWord(word);
					}}
				/>
				{synonymWord && (
					<SynonymPanel
						word={synonymWord}
						onSelect={setSynonymWord}
						onClose={() => setSynonymWord(null)}
					/>
				)}
			</div>
		</div>
	);
}
