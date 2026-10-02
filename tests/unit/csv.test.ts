import { describe, expect, test } from 'bun:test';
import { attachmentDisposition, csvCell, toCsv } from '$lib/server/csv';

describe('csvCell', () => {
	test('leaves plain text as it is', () => {
		expect(csvCell('参加する')).toBe('参加する');
		expect(csvCell('')).toBe('');
		expect(csvCell('2026/04/12 21:40')).toBe('2026/04/12 21:40');
	});

	test('quotes a comma, a quote, CR or LF, and doubles the quotes inside', () => {
		expect(csvCell('A、B, C')).toBe('"A、B, C"');
		expect(csvCell('彼は"来る"と')).toBe('"彼は""来る""と"');
		expect(csvCell('一行目\n二行目')).toBe('"一行目\n二行目"');
		expect(csvCell('一行目\r\n二行目')).toBe('"一行目\r\n二行目"');
	});

	test('keeps a spreadsheet from reading a cell as a formula', () => {
		expect(csvCell('=1+1')).toBe("'=1+1");
		expect(csvCell('+81 90')).toBe("'+81 90");
		expect(csvCell('-5度')).toBe("'-5度");
		expect(csvCell('@here')).toBe("'@here");
		expect(csvCell('\tタブ')).toBe("'\tタブ");
		// Prefixed first, then quoted for the CR it still carries.
		expect(csvCell('\r改行')).toBe(`"'\r改行"`);
		expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
		// Only at the start.
		expect(csvCell('1+1=2')).toBe('1+1=2');
	});
});

describe('toCsv', () => {
	test('starts with a BOM and ends every record with CRLF', () => {
		expect(
			toCsv([
				['a', 'b'],
				['c,d', '']
			])
		).toBe(`${String.fromCharCode(0xfeff)}a,b\r\n"c,d",\r\n`);
	});
});

describe('attachmentDisposition', () => {
	test('gives an ASCII fallback and the title percent-encoded', () => {
		expect(attachmentDisposition('春合宿 (5月)', 'responses', 'csv')).toBe(
			`attachment; filename="responses.csv"; filename*=UTF-8''${encodeURIComponent('春合宿')}%20%285%E6%9C%88%29.csv`
		);
	});

	test('drops characters no file name may hold, and falls back when nothing is left', () => {
		expect(attachmentDisposition('a/b:c*?"<>|\n', 'responses', 'csv')).toBe(
			`attachment; filename="responses.csv"; filename*=UTF-8''a%20b%20c.csv`
		);
		expect(attachmentDisposition(' / ', 'responses', 'csv')).toBe(
			`attachment; filename="responses.csv"; filename*=UTF-8''responses.csv`
		);
	});

	test('cuts a long title without splitting a character', () => {
		const disposition = attachmentDisposition('😀'.repeat(150), 'responses', 'csv');
		const encoded = disposition.split("UTF-8''")[1].replace(/\.csv$/, '');
		expect(decodeURIComponent(encoded)).toBe('😀'.repeat(100));
	});
});
