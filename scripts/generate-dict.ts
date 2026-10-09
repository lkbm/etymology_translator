#!/usr/bin/env npx tsx
/**
 * Generate etymology dictionary from etymology-db (Wiktionary-derived dataset).
 * Follows etymological chains to find the ultimate root language for each English word.
 *
 * Usage:  npx tsx scripts/generate-dict.ts
 *
 * Downloads etymology.csv.gz (~137MB) on first run, caches in scripts/.cache/
 *
 * Writes two outputs:
 *   - src/etymologyDict.ts: bundled into the client, so limited to common words
 *   - scripts/.cache/etymology-full.json: every classified word, for generate-synonyms
 */

import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	writeFileSync,
} from 'fs';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { FULL_DICT_PATH, readFrequentWords } from './datasets';

const ETYMOLOGY_DB_URL =
	'https://github.com/droher/etymology-db/releases/download/2023-12/etymology.csv.gz';
const CACHE_DIR = join(import.meta.dirname!, '.cache');
const CSV_GZ_PATH = join(CACHE_DIR, 'etymology.csv.gz');
const CSV_PATH = join(CACHE_DIR, 'etymology.csv');
const OUT_PATH = join(import.meta.dirname!, '..', 'src', 'etymologyDict.ts');

// Words classified only via their parts are far more numerous (and rarer) than
// ones with a direct etymology; ship them to the client only if they're among
// the N most frequent English words.
const CLIENT_FREQUENCY_LIMIT = 150_000;

// Relation types that represent etymological ancestry (for chain-following)
const ANCESTRY_RELATIONS = new Set([
	'inherited_from',
	'borrowed_from',
	'derived_from',
	'learned_borrowing_from',
	'semi_learned_borrowing_from',
	'orthographic_borrowing_from',
	'unadapted_borrowing_from',
	'calque_of',
	'semantic_loan_of',
]);

// Relation types that break a word into parts (merriment = merry + -ment).
// Used as a fallback for words with no ancestry: we classify them by their root part.
const MORPHOLOGY_RELATIONS = new Set([
	'has_prefix_with_root',
	'has_root',
	'has_affix',
	'has_confix',
	'compound_of',
	'etymologically_related_to',
	'clipping_of',
	'back-formation_from',
]);

// Map full language names → our bucket categories
// We follow chains THROUGH intermediate languages (like Old French)
// and stop at these "root" languages
const LANG_TO_BUCKET: Record<string, string> = {
	// Latin family
	Latin: 'latin',
	'Vulgar Latin': 'latin',
	'Medieval Latin': 'latin',
	'New Latin': 'latin',
	'Late Latin': 'latin',
	'Ecclesiastical Latin': 'latin',
	'Proto-Italic': 'latin',

	// Greek
	'Ancient Greek': 'greek',
	'Koine Greek': 'greek',
	'Byzantine Greek': 'greek',

	// Anglo-Saxon / Old English
	'Old English': 'anglo-saxon',
	'Middle English': 'anglo-saxon',

	// Old Norse
	'Old Norse': 'old-norse',
	'Old Swedish': 'old-norse',
	'Old Danish': 'old-norse',

	// French (intermediate — we follow through these to find deeper roots)
	'Old French': 'french',
	'Middle French': 'french',
	French: 'french',
	'Anglo-Norman': 'french',
	'Old Northern French': 'french',

	// Germanic
	'Proto-Germanic': 'germanic',
	'Proto-West Germanic': 'germanic',
	Frankish: 'germanic',
	'Old High German': 'germanic',
	'Middle High German': 'germanic',
	German: 'germanic',
	'Old Dutch': 'germanic',
	'Middle Dutch': 'germanic',
	Dutch: 'germanic',
	'Old Saxon': 'germanic',
	'Middle Low German': 'germanic',
	'Low German': 'germanic',
	'Old Frisian': 'germanic',
	'West Frisian': 'germanic',

	// Celtic
	'Proto-Celtic': 'celtic',
	'Old Irish': 'celtic',
	'Middle Irish': 'celtic',
	Irish: 'celtic',
	'Scottish Gaelic': 'celtic',
	Welsh: 'celtic',
	'Middle Welsh': 'celtic',
	'Old Welsh': 'celtic',
	Breton: 'celtic',
	Cornish: 'celtic',
	Gaulish: 'celtic',
};

// Languages that are "too deep" — stop before these
const TOO_ABSTRACT = new Set([
	'Proto-Indo-European',
	'Proto-Indo-Iranian',
	'Proto-Balto-Slavic',
	'Proto-Uralic',
	'Proto-Semitic',
	'Proto-Afro-Asiatic',
]);

// Root priority: when choosing between an intermediate and deeper root,
// prefer the deeper one. Higher number = deeper = preferred.
const BUCKET_DEPTH: Record<string, number> = {
	french: 1, // French is often intermediate → Latin
	'anglo-saxon': 2, // Old English is often the "real" origin for native words
	'old-norse': 2,
	germanic: 3, // Proto-Germanic is deeper than OE/ON
	celtic: 3,
	latin: 4, // Latin is usually the ultimate root for Romance-path words
	greek: 5, // Greek is often the deepest we can meaningfully go
};

// ─── CSV parsing ────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"' && line[i + 1] === '"') {
				current += '"';
				i++;
			} else if (ch === '"') {
				inQuotes = false;
			} else {
				current += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ',') {
			fields.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	fields.push(current);
	return fields;
}

// ─── Download ───────────────────────────────────────────────────

async function downloadFile(url: string, dest: string): Promise<void> {
	console.log(`Downloading ${url}...`);
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);

	const fileStream = createWriteStream(dest);
	await pipeline(res.body!, fileStream);
	console.log(`Saved to ${dest}`);
}

async function ensureCSV(): Promise<string> {
	mkdirSync(CACHE_DIR, { recursive: true });

	if (existsSync(CSV_PATH)) {
		console.log('Using cached CSV');
		return CSV_PATH;
	}

	if (!existsSync(CSV_GZ_PATH)) {
		await downloadFile(ETYMOLOGY_DB_URL, CSV_GZ_PATH);
	}

	console.log('Decompressing...');
	await pipeline(
		createReadStream(CSV_GZ_PATH),
		createGunzip(),
		createWriteStream(CSV_PATH),
	);
	console.log('Decompressed');
	return CSV_PATH;
}

// ─── Graph building ─────────────────────────────────────────────

interface TermInfo {
	lang: string;
	term: string;
}

async function buildGraph(csvPath: string) {
	// term_id → info about that term
	const terms = new Map<string, TermInfo>();
	// term_id → list of ancestor term_ids (via etymological relations)
	const ancestors = new Map<string, string[]>();
	// English word (lowercase) → term_id
	const englishWords = new Map<string, string>();
	// term_id → its non-affix parts as [position, term_id] (via morphological relations)
	const parts = new Map<string, [number, string][]>();

	const rl = createInterface({
		input: createReadStream(csvPath, 'utf-8'),
		crlfDelay: Infinity,
	});

	let lineNum = 0;
	let skippedHeader = false;

	for await (const line of rl) {
		if (!skippedHeader) {
			skippedHeader = true;
			continue;
		}
		lineNum++;
		if (lineNum % 500_000 === 0)
			console.log(`  ...parsed ${(lineNum / 1_000_000).toFixed(1)}M rows`);

		const fields = parseCSVLine(line);
		// columns: term_id, lang, term, reltype, related_term_id, related_lang, related_term, ...
		const [
			termId,
			lang,
			term,
			reltype,
			relatedTermId,
			relatedLang,
			relatedTerm,
			position,
		] = fields;

		// Register term info
		if (termId && lang && !terms.has(termId)) {
			terms.set(termId, { lang, term });
		}
		if (relatedTermId && relatedLang && !terms.has(relatedTermId)) {
			terms.set(relatedTermId, { lang: relatedLang, term: relatedTerm });
		}

		// Track English words
		if (lang === 'English' && term) {
			const lower = term.toLowerCase();
			if (!englishWords.has(lower)) {
				englishWords.set(lower, termId);
			}
		}

		// Build ancestry edges (term was derived/borrowed FROM related_term)
		if (ANCESTRY_RELATIONS.has(reltype) && termId && relatedTermId) {
			const existing = ancestors.get(termId);
			if (existing) {
				existing.push(relatedTermId);
			} else {
				ancestors.set(termId, [relatedTermId]);
			}
		}

		// Build morphology edges, skipping affixes ("-ment", "sub-") — they say
		// little about where the word's core comes from
		const isAffix = relatedTerm?.startsWith('-') || relatedTerm?.endsWith('-');
		if (
			MORPHOLOGY_RELATIONS.has(reltype) &&
			termId &&
			relatedTermId &&
			!isAffix
		) {
			const part: [number, string] = [Number(position) || 0, relatedTermId];
			const existing = parts.get(termId);
			if (existing) {
				existing.push(part);
			} else {
				parts.set(termId, [part]);
			}
		}
	}

	console.log(
		`Parsed ${lineNum} rows: ${terms.size} terms, ${englishWords.size} English words, ${ancestors.size} have ancestry, ${parts.size} have parts`,
	);
	return { terms, ancestors, englishWords, parts };
}

// ─── Chain traversal ────────────────────────────────────────────

function findUltimateRoot(
	startId: string,
	terms: Map<string, TermInfo>,
	ancestors: Map<string, string[]>,
): string | null {
	let bestBucket: string | null = null;
	let bestDepth = -1;

	const visited = new Set<string>();
	const stack = [startId];

	while (stack.length > 0) {
		const id = stack.pop()!;
		if (visited.has(id)) continue;
		visited.add(id);

		const info = terms.get(id);
		if (!info) continue;

		// Don't go past PIE etc.
		if (TOO_ABSTRACT.has(info.lang)) continue;

		const bucket = LANG_TO_BUCKET[info.lang];
		if (bucket) {
			const depth = BUCKET_DEPTH[bucket] ?? 0;
			if (depth > bestDepth) {
				bestBucket = bucket;
				bestDepth = depth;
			}
		}

		// Follow ancestry edges
		const parents = ancestors.get(id);
		if (parents) {
			for (const parentId of parents) {
				if (!visited.has(parentId)) stack.push(parentId);
			}
		}
	}

	return bestBucket;
}

/**
 * Fallback for words formed within English (merriment, subcutaneous, hypodermic):
 * classify by the first part that resolves — the root, since affixes were
 * dropped when building `parts`. Parts may themselves be English formations
 * (hypodermic → hypodermis → derma), so this recurses up to a small depth.
 */
function findRootViaParts(
	startId: string,
	terms: Map<string, TermInfo>,
	ancestors: Map<string, string[]>,
	parts: Map<string, [number, string][]>,
	depth = 0,
	visited = new Set<string>(),
): string | null {
	if (depth > 3 || visited.has(startId)) return null;
	visited.add(startId);

	const ordered = [...(parts.get(startId) ?? [])].sort((a, b) => a[0] - b[0]);
	for (const [, partId] of ordered) {
		const bucket =
			findUltimateRoot(partId, terms, ancestors) ??
			findRootViaParts(partId, terms, ancestors, parts, depth + 1, visited);
		if (bucket) return bucket;
	}
	return null;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
	const csvPath = await ensureCSV();
	const { terms, ancestors, englishWords, parts } = await buildGraph(csvPath);

	console.log('\nClassifying English words...');
	const dict: Record<string, string> = {};
	const partsOnly = new Set<string>();
	let classified = 0;
	let unclassified = 0;

	for (const [word, termId] of englishWords) {
		// Skip single-character words, numbers, etc.
		if (word.length <= 1 && word !== 'i' && word !== 'a') continue;

		let bucket = findUltimateRoot(termId, terms, ancestors);
		if (!bucket) {
			bucket = findRootViaParts(termId, terms, ancestors, parts);
			if (bucket) partsOnly.add(word);
		}
		if (bucket) {
			dict[word] = bucket;
			classified++;
		} else {
			unclassified++;
		}
	}

	console.log(
		`Classified: ${classified} (${partsOnly.size} via word parts), Unclassified: ${unclassified}`,
	);

	writeFileSync(FULL_DICT_PATH, JSON.stringify(dict));
	console.log(`Wrote full dictionary to ${FULL_DICT_PATH}`);

	const frequent = await readFrequentWords(CLIENT_FREQUENCY_LIMIT);
	const clientDict = Object.entries(dict).filter(
		([word]) => !partsOnly.has(word) || frequent.has(word),
	);

	// Generate TypeScript output
	const entries = clientDict
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([word, origin]) => `\t'${word.replace(/'/g, "\\'")}': '${origin}',`)
		.join('\n');

	const output = `export type EtymologyOrigin =
\t| 'latin'
\t| 'greek'
\t| 'anglo-saxon'
\t| 'old-norse'
\t| 'french'
\t| 'germanic'
\t| 'celtic'
\t| 'unknown';

// Generated by scripts/generate-dict.ts from etymology-db (Wiktionary, CC-BY-SA 3.0)
// ${clientDict.length} of ${classified} classified words (rare word-part-only classifications omitted)
export const etymologyDict: Record<string, EtymologyOrigin> = {
${entries}
};
`;

	writeFileSync(OUT_PATH, output);
	console.log(`\nWrote ${clientDict.length} entries to ${OUT_PATH}`);

	// Print stats per bucket
	const stats: Record<string, number> = {};
	for (const [, origin] of clientDict) {
		stats[origin] = (stats[origin] ?? 0) + 1;
	}
	console.log('\nBreakdown:');
	for (const [bucket, count] of Object.entries(stats).sort(
		(a, b) => b[1] - a[1],
	)) {
		console.log(`  ${bucket}: ${count}`);
	}
}

main().catch(console.error);
