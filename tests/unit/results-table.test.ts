import { describe, expect, test } from 'bun:test';
import { resultTable, toHtml, toMarkdown } from '$lib/results-table';

const QUESTIONS = [
	{
		id: 1,
		label: '参加',
		options: [
			{ id: 'yes', label: '出席' },
			{ id: 'no', label: '欠席' }
		]
	},
	{ id: 2, label: '連絡事項', options: null }
];

const at = (jst: string) => new Date(`${jst}+09:00`);

describe('resultTable', () => {
	test('the target’s rows, then the outsiders’, with every answer spelled out and blanks left empty', () => {
		const table = resultTable(
			QUESTIONS,
			[
				{
					displayName: 'あおい',
					submittedAt: at('2025-12-31T09:05:00'),
					updatedAt: at('2026-01-02T21:40:00'),
					answers: { 1: { type: 'single', other: '途中から' }, 2: { type: 'text', text: 'なし' } }
				}
			],
			[
				{
					displayName: 'そと',
					submittedAt: at('2026-01-03T08:00:00'),
					updatedAt: at('2026-01-03T08:00:00'),
					answers: { 1: { type: 'single', optionId: 'no' } }
				}
			]
		);

		expect(table).toEqual({
			header: ['回答者', '対象', '提出日時', '最終更新日時', '参加', '連絡事項'],
			rows: [
				['あおい', '対象', '2025/12/31 09:05', '2026/01/02 21:40', 'その他: 途中から', 'なし'],
				['そと', '対象外', '2026/01/03 08:00', '2026/01/03 08:00', '欠席', '']
			]
		});
	});
});

const TABLE = {
	header: ['回答者', 'A|B'],
	rows: [
		['あおい', '一行目\n二行目'],
		['<b>いつき</b>', ''],
		['"う" & \'み\'', 'x\r\ny\rz']
	]
};

describe('toMarkdown', () => {
	test('escapes pipes, turns line breaks into <br>, and keeps empty cells', () => {
		expect(toMarkdown(TABLE)).toBe(
			[
				'| 回答者 | A\\|B |',
				'| --- | --- |',
				'| あおい | 一行目<br>二行目 |',
				'| <b>いつき</b> |  |',
				`| "う" & 'み' | x<br>y<br>z |`
			].join('\n')
		);
	});
});

describe('toHtml', () => {
	test('a bare table with the text escaped and line breaks as <br>', () => {
		expect(toHtml(TABLE)).toBe(
			'<table><thead><tr><th>回答者</th><th>A|B</th></tr></thead><tbody>' +
				'<tr><td>あおい</td><td>一行目<br>二行目</td></tr>' +
				'<tr><td>&lt;b&gt;いつき&lt;/b&gt;</td><td></td></tr>' +
				'<tr><td>&quot;う&quot; &amp; &#39;み&#39;</td><td>x<br>y<br>z</td></tr>' +
				'</tbody></table>'
		);
	});

	test('a table with no responses still has its header', () => {
		expect(toHtml({ header: ['回答者'], rows: [] })).toBe(
			'<table><thead><tr><th>回答者</th></tr></thead><tbody></tbody></table>'
		);
	});
});
