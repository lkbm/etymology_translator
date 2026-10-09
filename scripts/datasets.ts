/**
 * Shared download/cache helpers for the generate-* scripts.
 * Everything lands in scripts/.cache/ on first use.
 */

import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	renameSync,
} from 'fs';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';

export const CACHE_DIR = join(import.meta.dirname!, '.cache');

// Full etymology classification (written by generate-dict, read by generate-synonyms).
// The client bundle only ships common words; synonym shards can use all of them.
export const FULL_DICT_PATH = join(CACHE_DIR, 'etymology-full.json');

export interface Dataset {
	url: string;
	file: string;
}

export const DATASETS = {
	// Open English WordNet 2024 (CC-BY 4.0): precise, POS-specific synsets
	wordnet: {
		url: 'https://github.com/globalwordnet/english-wordnet/releases/download/2024-edition/english-wordnet-2024.xml.gz',
		file: 'english-wordnet-2024.xml.gz',
	},
	// Moby Thesaurus II (public domain): broad, loose, crosses parts of speech
	moby: {
		url: 'https://www.gutenberg.org/files/3202/files/mthesaur.txt',
		file: 'mthesaur.txt',
	},
	// GloVe 300d, Wikipedia+Gigaword (PDDL): word vectors, listed most-frequent first
	glove: {
		url: 'https://github.com/RaRe-Technologies/gensim-data/releases/download/glove-wiki-gigaword-300/glove-wiki-gigaword-300.gz',
		file: 'glove-wiki-gigaword-300.gz',
	},
} satisfies Record<string, Dataset>;

export async function ensureDataset({ url, file }: Dataset): Promise<string> {
	mkdirSync(CACHE_DIR, { recursive: true });
	const dest = join(CACHE_DIR, file);
	if (existsSync(dest)) return dest;

	console.log(`Downloading ${url}...`);
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
	// Write to a temp name so an interrupted download isn't mistaken for a cached file
	await pipeline(
		Readable.fromWeb(res.body as NodeReadableStream),
		createWriteStream(dest + '.part'),
	);
	renameSync(dest + '.part', dest);
	return dest;
}

export function readLines(path: string) {
	const stream = path.endsWith('.gz')
		? createReadStream(path).pipe(createGunzip())
		: createReadStream(path, 'utf-8');
	return createInterface({ input: stream, crlfDelay: Infinity });
}

/** Words in GloVe's vocabulary, most frequent first, up to `limit`. */
export async function readFrequentWords(limit: number): Promise<Set<string>> {
	const path = await ensureDataset(DATASETS.glove);
	const stream = createReadStream(path).pipe(createGunzip());
	const words = new Set<string>();
	let first = true;
	for await (const line of createInterface({
		input: stream,
		crlfDelay: Infinity,
	})) {
		if (first) {
			first = false;
			continue;
		} // "400000 300" header
		words.add(line.slice(0, line.indexOf(' ')));
		if (words.size >= limit) break;
	}
	// Stop decompressing the rest of the (large) file
	stream.destroy();
	return words;
}
