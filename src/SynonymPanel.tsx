import { useEffect, useState } from 'preact/hooks';
import type { EtymologyOrigin } from './etymologyDict';
import { ORIGIN_LABELS, ORIGIN_ORDER } from './origins';
import { getSynonyms, type Synonym, type SynonymResult } from './synonyms';

type State =
	| { status: 'loading' }
	| { status: 'done'; result: SynonymResult | null }
	| { status: 'error'; message: string };

interface Props {
	word: string;
	onSelect: (word: string) => void;
	onClose: () => void;
}

export function SynonymPanel({ word, onSelect, onClose }: Props) {
	const [state, setState] = useState<State>({ status: 'loading' });
	const [draft, setDraft] = useState(word);

	useEffect(() => {
		setDraft(word);
		setState({ status: 'loading' });
		// Ignore responses for a word the user has already moved on from
		let current = true;
		getSynonyms(word)
			.then((result) => current && setState({ status: 'done', result }))
			.catch(
				(err: Error) =>
					current && setState({ status: 'error', message: err.message }),
			);
		return () => {
			current = false;
		};
	}, [word]);

	return (
		<aside class="synonym-panel">
			<form
				class="synonym-search"
				onSubmit={(e) => {
					e.preventDefault();
					const next = draft.trim();
					if (next) onSelect(next);
				}}
			>
				<input
					value={draft}
					onInput={(e) => setDraft(e.currentTarget.value)}
					placeholder="Find synonyms…"
					aria-label="Word to find synonyms for"
				/>
				<button
					type="button"
					class="synonym-close"
					onClick={onClose}
					aria-label="Close synonyms"
				>
					×
				</button>
			</form>
			<div class="synonym-body">
				{state.status === 'loading' && <p class="synonym-status">Loading…</p>}
				{state.status === 'error' && <p class="synonym-status">{state.message}</p>}
				{state.status === 'done' && !state.result && (
					<p class="synonym-status">No synonyms found for “{word}”.</p>
				)}
				{state.status === 'done' && state.result && (
					<SynonymGroups result={state.result} query={word} onSelect={onSelect} />
				)}
			</div>
		</aside>
	);
}

function SynonymGroups({
	result,
	query,
	onSelect,
}: {
	result: SynonymResult;
	query: string;
	onSelect: (w: string) => void;
}) {
	const groups = new Map<EtymologyOrigin, Synonym[]>();
	for (const syn of result.synonyms) {
		const list = groups.get(syn.origin);
		if (list) list.push(syn);
		else groups.set(syn.origin, [syn]);
	}

	return (
		<>
			<h2 class="synonym-headword">
				<span class={`etym-${result.origin}`}>{result.headword}</span>
				<span class="synonym-origin">{ORIGIN_LABELS[result.origin]}</span>
			</h2>
			{result.headword !== query.toLowerCase() && (
				<p class="synonym-status">Showing results for “{result.headword}”</p>
			)}
			{/* Fixed language order, so each language's column is always in the same place */}
			{ORIGIN_ORDER.filter((o) => groups.has(o)).map((origin) => (
				<section key={origin} class="synonym-group">
					<h3 class={`etym-${origin}`}>
						{ORIGIN_LABELS[origin]}
						{origin === result.origin && (
							<span class="synonym-same"> · same origin</span>
						)}
					</h3>
					<ul>
						{groups.get(origin)!.map((syn) => (
							<li key={syn.word}>
								<button
									class={`synonym-word etym-${origin}`}
									onClick={() => onSelect(syn.word)}
									title={`Closeness ${syn.score}/100`}
								>
									{syn.word}
								</button>
								<span class="synonym-score" style={{ width: `${syn.score}%` }} />
							</li>
						))}
					</ul>
				</section>
			))}
		</>
	);
}
