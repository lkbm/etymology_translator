import type { EtymologyOrigin } from './etymologyDict';
import { candidateForms } from './lookup';
import {
	SYNONYM_DIR,
	decodeOrigin,
	shardKey,
	type SynonymShard,
} from './synonymShard';

export interface Synonym {
	word: string;
	score: number; // 0–100, higher = closer
	origin: EtymologyOrigin;
}

export interface SynonymResult {
	headword: string; // may differ from the query, e.g. "hypodermics" → "hypodermic"
	origin: EtymologyOrigin;
	synonyms: Synonym[]; // sorted by score descending
}

// One request per shard per session; failed requests are evicted so they can be retried
const shardCache = new Map<string, Promise<SynonymShard>>();

function loadShard(key: string): Promise<SynonymShard> {
	let shard = shardCache.get(key);
	if (!shard) {
		shard = fetch(`/${SYNONYM_DIR}/${key}.json`).then((res) => {
			// A missing shard just means no words start with those letters.
			// (The Vite dev server answers missing files with index.html, not a 404.)
			if (res.status === 404) return {};
			if (!res.ok) throw new Error(`Failed to load synonyms (${res.status})`);
			if (!res.headers.get('content-type')?.includes('json')) return {};
			return res.json();
		});
		shard.catch(() => shardCache.delete(key));
		shardCache.set(key, shard);
	}
	return shard;
}

/** Returns null if neither the word nor any of its stems has synonyms. */
export async function getSynonyms(word: string): Promise<SynonymResult | null> {
	for (const form of candidateForms(word)) {
		const entry = (await loadShard(shardKey(form)))[form];
		if (!entry) continue;

		const [originCode, synonyms] = entry;
		return {
			headword: form,
			origin: decodeOrigin(originCode),
			synonyms: synonyms.map(([w, score, code]) => ({
				word: w,
				score,
				origin: decodeOrigin(code),
			})),
		};
	}
	return null;
}
