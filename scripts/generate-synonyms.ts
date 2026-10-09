#!/usr/bin/env npx tsx
/**
 * Generate ranked synonym shards for the synonym finder.
 *
 * Candidates come from thesauri (they decide *what* is a synonym);
 * GloVe embeddings only decide the *order*. Embeddings alone would pull in
 * antonyms and merely-related words (hot→cold, hypodermic→syringe).
 *
 * Inputs (see scripts/datasets.ts; downloaded to scripts/.cache/ on first run):
 *   - WordNet, Moby Thesaurus, GloVe
 *   - scripts/.cache/etymology-full.json from generate-dict.ts (run that first)
 *
 * Output: public/synonyms/{shard}.json — format in src/synonymShard.ts
 *
 * Usage:  npx tsx scripts/generate-synonyms.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DATASETS, FULL_DICT_PATH, ensureDataset, readLines } from './datasets';
import {
	SYNONYM_DIR,
	encodeOrigin,
	shardKey,
	type ShardSynonym,
	type SynonymShard,
} from '../src/synonymShard';
import { lookupIn } from '../src/lookup';
import type { EtymologyOrigin } from '../src/etymologyDict';

const OUT_DIR = join(import.meta.dirname!, '..', 'public', SYNONYM_DIR);

// Max synonyms kept per headword, and the minimum score (0–1) to keep one
const MAX_SYNONYMS = 40;
const MIN_SCORE = 0.2;

// Single lowercase words only — the highlighter works word-by-word, so
// phrases ("have fun") and proper nouns ("Paris") can't be clicked anyway.
const WORD_RE = /^[a-z][a-z'-]*[a-z]$|^[a-z]$/;

// ─── Evidence collection ────────────────────────────────────────

// Each source is a separate piece of evidence that two words are synonyms
const EVIDENCE = {
	wordnetSynset: 1 << 0, // share a WordNet synset (strongest)
	wordnetSimilar: 1 << 1, // synsets linked by WordNet "similar"/"also"
	mobyForward: 1 << 2, // Moby lists candidate under headword
	mobyReverse: 1 << 3, // Moby lists headword under candidate
} as const;

// headword → candidate → evidence bitmask
const pairs = new Map<string, Map<string, number>>();

function addEvidence(a: string, b: string, flag: number) {
	if (a === b || !WORD_RE.test(a) || !WORD_RE.test(b)) return;
	let row = pairs.get(a);
	if (!row) pairs.set(a, (row = new Map()));
	row.set(b, (row.get(b) ?? 0) | flag);
}

async function loadWordnet(path: string) {
	console.log('Parsing WordNet...');
	const entryLemma = new Map<string, string>(); // entry id → lemma
	const synsetMembers = new Map<string, string[]>(); // synset id → entry ids
	const synsetRelated: [string, string][] = [];
	let currentEntry: string | null = null;
	let currentSynset: string | null = null;

	for await (const line of readLines(path)) {
		let m;
		if ((m = line.match(/<LexicalEntry id="([^"]+)"/))) {
			currentEntry = m[1];
		} else if (currentEntry && (m = line.match(/<Lemma writtenForm="([^"]+)"/))) {
			entryLemma.set(currentEntry, m[1]);
			currentEntry = null;
		} else if ((m = line.match(/<Synset id="([^"]+)"[^>]*members="([^"]+)"/))) {
			currentSynset = m[1];
			synsetMembers.set(m[1], m[2].split(' '));
		} else if (
			currentSynset &&
			(m = line.match(/<SynsetRelation relType="(similar|also)" target="([^"]+)"/))
		) {
			synsetRelated.push([currentSynset, m[2]]);
		}
	}

	const lemmasOf = (synset: string) =>
		(synsetMembers.get(synset) ?? [])
			.map((e) => entryLemma.get(e))
			.filter((w): w is string => !!w);

	for (const synset of synsetMembers.keys()) {
		const words = lemmasOf(synset);
		for (const a of words)
			for (const b of words) addEvidence(a, b, EVIDENCE.wordnetSynset);
	}
	for (const [from, to] of synsetRelated) {
		const target = lemmasOf(to);
		for (const a of lemmasOf(from)) {
			for (const b of target) {
				addEvidence(a, b, EVIDENCE.wordnetSimilar);
				addEvidence(b, a, EVIDENCE.wordnetSimilar);
			}
		}
	}
	console.log(`  ${synsetMembers.size} synsets, ${entryLemma.size} entries`);
}

async function loadMoby(path: string) {
	console.log('Parsing Moby Thesaurus...');
	let rows = 0;
	for await (const line of readLines(path)) {
		const [head, ...syns] = line.split(',');
		for (const syn of syns) {
			addEvidence(head, syn, EVIDENCE.mobyForward);
			addEvidence(syn, head, EVIDENCE.mobyReverse);
		}
		rows++;
	}
	console.log(`  ${rows} headwords`);
}

// Only loads vectors for words that appear in some synonym pair,
// so memory stays proportional to the vocabulary, not to GloVe's 400k words.
async function loadVectors(path: string, vocab: Set<string>) {
	console.log('Loading GloVe vectors...');
	const vectors = new Map<string, Float32Array>();
	let first = true;
	for await (const line of readLines(path)) {
		if (first) {
			first = false;
			continue;
		} // "400000 300" header
		const space = line.indexOf(' ');
		const word = line.slice(0, space);
		if (!vocab.has(word)) continue;

		const vec = Float32Array.from(line.slice(space + 1).split(' '), Number);
		let norm = 0;
		for (const x of vec) norm += x * x;
		norm = Math.sqrt(norm);
		for (let i = 0; i < vec.length; i++) vec[i] /= norm;
		vectors.set(word, vec);
	}
	console.log(`  ${vectors.size} of ${vocab.size} words have vectors`);
	return vectors;
}

function cosine(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
	return dot;
}

// ─── Scoring ────────────────────────────────────────────────────

// How much each source independently convinces us two words are synonyms.
// A shared WordNet synset is a curated "same meaning in this sense" claim;
// Moby lists are looser (hypodermic → syringe, injection, skinny).
const EVIDENCE_WEIGHT: [number, number][] = [
	[EVIDENCE.wordnetSynset, 0.9],
	[EVIDENCE.wordnetSimilar, 0.5],
	[EVIDENCE.mobyForward, 0.4],
	[EVIDENCE.mobyReverse, 0.4],
];

// Fallback similarity for words GloVe doesn't know: they're rare,
// so rank them below comparable words we *can* measure.
const UNKNOWN_SIMILARITY = 0.15;

// GloVe cosine for good synonyms sits around 0.4–0.7; stretch it so
// ~0.7 counts as "maximally similar" before blending.
const SIMILARITY_CEILING = 0.7;

/**
 * Score in [0, 1]: thesaurus confidence blended with embedding similarity.
 *
 * Evidence combines as a noisy-OR, so independent sources compound
 * (Moby both ways = 0.64; WordNet + Moby ≈ 0.94) without exceeding 1.
 * Similarity then reorders words with comparable evidence: among Moby's
 * ~100 loose synonyms for "fun", it lifts "amusement" above "sport".
 * Confidence gets the larger share so a co-occurring-but-wrong word
 * (syringe) can't outrank a curated synonym (subcutaneous).
 */
function score(evidence: number, similarity: number | null): number {
	let doubt = 1;
	for (const [flag, weight] of EVIDENCE_WEIGHT) {
		if (evidence & flag) doubt *= 1 - weight;
	}
	const confidence = 1 - doubt;
	const sim =
		similarity === null
			? UNKNOWN_SIMILARITY
			: Math.min(1, Math.max(0, similarity) / SIMILARITY_CEILING);
	return 0.6 * confidence + 0.4 * sim;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
	if (!existsSync(FULL_DICT_PATH)) {
		throw new Error(
			`Missing ${FULL_DICT_PATH} — run scripts/generate-dict.ts first`,
		);
	}
	const fullDict: Record<string, EtymologyOrigin> = JSON.parse(
		readFileSync(FULL_DICT_PATH, 'utf-8'),
	);
	const originCode = (word: string) => encodeOrigin(lookupIn(fullDict, word));

	const [wordnetPath, mobyPath, glovePath] = await Promise.all([
		ensureDataset(DATASETS.wordnet),
		ensureDataset(DATASETS.moby),
		ensureDataset(DATASETS.glove),
	]);

	await loadWordnet(wordnetPath);
	await loadMoby(mobyPath);

	const vocab = new Set(pairs.keys());
	const vectors = await loadVectors(glovePath, vocab);

	console.log('Scoring...');
	const shards = new Map<string, SynonymShard>();
	let kept = 0;

	for (const [head, candidates] of pairs) {
		const headVec = vectors.get(head);
		const ranked: ShardSynonym[] = [];
		for (const [cand, evidence] of candidates) {
			const candVec = vectors.get(cand);
			const sim = headVec && candVec ? cosine(headVec, candVec) : null;
			const s = score(evidence, sim);
			if (s >= MIN_SCORE)
				ranked.push([cand, Math.round(s * 100), originCode(cand)]);
		}
		if (ranked.length === 0) continue;

		ranked.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
		const key = shardKey(head);
		let shard = shards.get(key);
		if (!shard) shards.set(key, (shard = {}));
		shard[head] = [originCode(head), ranked.slice(0, MAX_SYNONYMS)];
		kept++;
	}

	// Replace the whole directory so shards for removed prefixes don't linger
	rmSync(OUT_DIR, { recursive: true, force: true });
	mkdirSync(OUT_DIR, { recursive: true });
	let bytes = 0;
	let largest = 0;
	for (const [key, shard] of shards) {
		const json = JSON.stringify(shard);
		writeFileSync(join(OUT_DIR, `${key}.json`), json);
		bytes += json.length;
		largest = Math.max(largest, json.length);
	}

	console.log(
		`\nWrote ${kept} headwords across ${shards.size} shards to ${OUT_DIR}`,
	);
	console.log(
		`  total ${(bytes / 1e6).toFixed(1)}MB, largest shard ${(largest / 1e3).toFixed(0)}KB`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
