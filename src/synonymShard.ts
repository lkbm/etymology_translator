// Shared between scripts/generate-synonyms.ts (writer) and src/synonyms.ts (reader).
// Synonym lists are split into static JSON shards keyed by a word's first two letters,
// e.g. "hypodermic" → /synonyms/hy.json. Shard size stays flat as the vocabulary grows.

import type { EtymologyOrigin } from './etymologyDict';

export const SYNONYM_DIR = 'synonyms';

// One-letter origin codes keep shards small (an origin is stored per synonym).
// Origins come from the full build-time dictionary, which covers rare words
// the client's bundled dictionary omits.
const ORIGIN_CODES: Record<EtymologyOrigin, string> = {
	latin: 'l',
	greek: 'g',
	'anglo-saxon': 'a',
	'old-norse': 'n',
	french: 'f',
	germanic: 'd',
	celtic: 'c',
	unknown: 'u',
};
const CODE_ORIGINS = Object.fromEntries(
	Object.entries(ORIGIN_CODES).map(([origin, code]) => [code, origin]),
) as Record<string, EtymologyOrigin>;

export const encodeOrigin = (origin: EtymologyOrigin) => ORIGIN_CODES[origin];
export const decodeOrigin = (code: string): EtymologyOrigin =>
	CODE_ORIGINS[code] ?? 'unknown';

// [synonym, score 0–100, origin code]
export type ShardSynonym = [string, number, string];

// headword → [headword origin code, synonyms sorted by score descending]
export type SynonymShard = Record<string, [string, ShardSynonym[]]>;

export function shardKey(word: string): string {
	const norm = (c: string | undefined) => (c && c >= 'a' && c <= 'z' ? c : '_');
	return norm(word[0]) + norm(word[1]);
}
