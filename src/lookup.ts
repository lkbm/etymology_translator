import { etymologyDict, type EtymologyOrigin } from './etymologyDict';

// Suffixes to strip, longest/most-specific first.
// Each entry: [suffix to remove, replacement to append]
const SUFFIX_RULES: [string, string][] = [
	// Doubled-consonant + ing (sitting→sit, running→run, etc.)
	['tting', 't'],
	['nning', 'n'],
	['mming', 'm'],
	['pping', 'p'],
	['gging', 'g'],
	['gging', 'g'],
	['bbing', 'b'],
	['dding', 'd'],
	['lling', 'l'],
	['zzing', 'z'],
	['ssing', 'ss'],
	// Multi-syllable suffixes
	['ically', 'ic'], // historically → historic
	['iness', 'y'], // happiness → happy
	['ation', 'ate'], // creation → create
	['ation', ''], // nation → nation (direct match takes priority anyway)
	['ement', 'e'], // movement → move
	['ments', 'ment'], // movements → movement
	['ness', ''], // darkness → dark
	['ment', ''], // judgment → judg
	['able', ''], // comfortable → comfort
	['ible', ''], // sensible → sens
	['tion', 't'], // action → act
	['sion', 'de'], // explosion → explode
	['iest', 'y'], // happiest → happy
	['ical', 'ic'], // logical → logic
	['ally', 'al'], // finally → final
	['ous', ''], // famous → fam
	['ing', 'e'], // making → make
	['ing', ''], // walking → walk
	['ied', 'y'], // carried → carry
	['ies', 'y'], // carries → carry
	['est', ''], // fastest → fast
	['ers', 'er'], // workers → worker
	['ful', ''], // hopeful → hope
	['ism', ''], // heroism → hero
	['ist', ''], // artist → art
	['ive', 'e'], // creative → create
	['ive', ''], // active → act
	['ize', ''], // modernize → modern
	['ise', ''], // modernise → modern
	['ely', 'e'], // purely → pure
	['ly', ''], // quickly → quick
	['ed', 'e'], // loved → love
	['ed', ''], // walked → walk
	['er', 'e'], // rider → ride
	['er', ''], // worker → work
	['en', ''], // golden → gold
	['al', ''], // musical → music
	['es', ''], // watches → watch
	["'s", ''], // king's → king
	['s', ''], // words → word
];

/**
 * Forms to try when looking up a word, in priority order:
 * the normalized word itself, then stems from suffix stripping.
 */
export function candidateForms(word: string): string[] {
	const normalized = word.toLowerCase().replace(/[^a-z'-]/g, '');
	if (!normalized) return [];

	const forms = [normalized];
	for (const [suffix, replacement] of SUFFIX_RULES) {
		if (suffix.length >= normalized.length) continue;
		if (!normalized.endsWith(suffix)) continue;

		const stem = normalized.slice(0, -suffix.length) + replacement;
		if (stem.length >= 2) forms.push(stem);
	}
	return forms;
}

/** Look up a word's origin in any dictionary (the build scripts use the full one). */
export function lookupIn(
	dict: Record<string, EtymologyOrigin>,
	word: string,
): EtymologyOrigin {
	for (const form of candidateForms(word)) {
		const origin = dict[form];
		if (origin) return origin;
	}
	return 'unknown';
}

export function lookupEtymology(word: string): EtymologyOrigin {
	return lookupIn(etymologyDict, word);
}
