/** Narrowing a list by what is typed into a search box, for the editor's role and channel pickers. */

const KATAKANA = /[ァ-ヶ]/g;

/** Katakana and hiragana sit 0x60 apart, letter for letter. */
const KANA_OFFSET = 0x60;

/**
 * Folds away what a search should not tell apart: full- and half-width (NFKC, which also joins a
 * half-width katakana and its voicing mark), upper and lower case, and katakana and hiragana.
 */
export function searchKey(text: string): string {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.replace(KATAKANA, (char) => String.fromCharCode(char.charCodeAt(0) - KANA_OFFSET));
}

/** Whether `text` contains `query`, both folded. A blank query matches everything. */
export function matchesQuery(text: string, query: string): boolean {
	return searchKey(text).includes(searchKey(query.trim()));
}
