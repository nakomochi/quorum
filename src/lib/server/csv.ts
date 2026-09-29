/** RFC 4180 CSV, as spreadsheet software opens it. */

// A cell starting with one of these is read as a formula by spreadsheets.
const FORMULA_START = /^[=+\-@\t\r]/;

const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: string): string {
	const text = FORMULA_START.test(value) ? `'${value}` : value;
	return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const BOM = String.fromCharCode(0xfeff);

/** With a BOM, which Excel needs to read UTF-8, and CRLF after every record. */
export function toCsv(records: string[][]): string {
	return `${BOM}${records.map((record) => `${record.map(csvCell).join(',')}\r\n`).join('')}`;
}

// Characters that no file system takes in a name, and control characters.
const UNSAFE_IN_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** In code points: cutting UTF-16 units could split a surrogate pair, which cannot be encoded. */
const MAX_NAME = 100;

/**
 * `filename` is a plain ASCII fallback; `filename*` carries the real name, percent-encoded as RFC
 * 5987 asks, which leaves none of '()* unencoded.
 */
export function attachmentDisposition(name: string, fallback: string, extension: string): string {
	const cleaned = name.replace(UNSAFE_IN_NAME, ' ').replace(/\s+/g, ' ').trim();
	const safe = Array.from(cleaned).slice(0, MAX_NAME).join('').trim();
	const encoded = encodeURIComponent(safe || fallback).replace(
		/['()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
	);
	return `attachment; filename="${fallback}.${extension}"; filename*=UTF-8''${encoded}.${extension}`;
}
