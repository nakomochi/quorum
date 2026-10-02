/**
 * The responses as one table, for the results page's CSV and its copy button. Shared so that both
 * always carry the same columns; each output does its own escaping.
 */

import { formatJstWithYear } from './datetime';
import { describeAnswer, type AnswerValue } from './forms';

type TableQuestion = { id: number; label: string; options: { id: string; label: string }[] | null };

type TableRow = {
	displayName: string;
	submittedAt: Date;
	updatedAt: Date;
	answers: Record<number, AnswerValue>;
};

export type ResultTable = { header: string[]; rows: string[][] };

/**
 * The target's responses first, then the outsiders', each in the order the page lists them.
 * `outsiders` is null for a form without a role: every response is the target's, and the column
 * that tells the two apart is left out.
 */
export function resultTable(
	questions: TableQuestion[],
	submitted: TableRow[],
	outsiders: TableRow[] | null
): ResultTable {
	const row = (entry: TableRow, audience: string | null) => [
		entry.displayName,
		...(audience === null ? [] : [audience]),
		formatJstWithYear(entry.submittedAt),
		formatJstWithYear(entry.updatedAt),
		...questions.map((q) => {
			const value = entry.answers[q.id];
			return value ? describeAnswer(value, q.options) : '';
		})
	];

	if (outsiders === null) {
		return {
			header: ['回答者', '提出日時', '最終更新日時', ...questions.map((q) => q.label)],
			rows: submitted.map((entry) => row(entry, null))
		};
	}

	return {
		header: ['回答者', '対象', '提出日時', '最終更新日時', ...questions.map((q) => q.label)],
		rows: [
			...submitted.map((entry) => row(entry, '対象')),
			...outsiders.map((entry) => row(entry, '対象外'))
		]
	};
}

const LINE_BREAK = /\r\n|\r|\n/g;

/** A GFM table. A pipe would end the cell and a line break the row, so both are escaped. */
export function toMarkdown({ header, rows }: ResultTable): string {
	const line = (cells: string[]) =>
		`| ${cells.map((cell) => cell.replaceAll('|', '\\|').replace(LINE_BREAK, '<br>')).join(' | ')} |`;
	return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

/** A bare table, which spreadsheets and documents paste as cells. */
export function toHtml({ header, rows }: ResultTable): string {
	const cells = (tag: 'th' | 'td', values: string[]) =>
		`<tr>${values
			.map((value) => `<${tag}>${escapeHtml(value).replace(LINE_BREAK, '<br>')}</${tag}>`)
			.join('')}</tr>`;
	return `<table><thead>${cells('th', header)}</thead><tbody>${rows
		.map((row) => cells('td', row))
		.join('')}</tbody></table>`;
}
