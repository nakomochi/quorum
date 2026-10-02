import { describe, expect, test } from 'bun:test';
import { describeAnswer, sameAnswers, type RevisionAnswers } from '$lib/forms';
import { collectAnswerInputs } from '$lib/server/forms';
import type { Question } from '$lib/server/db/schema';

describe('sameAnswers', () => {
	test('ignores key order', () => {
		const a: RevisionAnswers = {
			'1': { type: 'text', text: 'x' },
			'2': { type: 'date', date: '2026-01-01' }
		};
		const b: RevisionAnswers = {
			'2': { type: 'date', date: '2026-01-01' },
			'1': { type: 'text', text: 'x' }
		};
		expect(sameAnswers(a, b)).toBe(true);
	});

	test('ignores the order of a multi answer, but not its members', () => {
		expect(
			sameAnswers(
				{ '1': { type: 'multi', optionIds: ['a', 'b'] } },
				{ '1': { type: 'multi', optionIds: ['b', 'a'] } }
			)
		).toBe(true);
		expect(
			sameAnswers(
				{ '1': { type: 'multi', optionIds: ['a', 'b'] } },
				{ '1': { type: 'multi', optionIds: ['a'] } }
			)
		).toBe(false);
		expect(
			sameAnswers(
				{ '1': { type: 'multi', optionIds: ['a'], other: 'x' } },
				{ '1': { type: 'multi', optionIds: ['a'] } }
			)
		).toBe(false);
	});

	test('compares text literally: trimming happens before, in the submission', () => {
		expect(
			sameAnswers({ '1': { type: 'text', text: 'x' } }, { '1': { type: 'text', text: 'x ' } })
		).toBe(false);
		expect(
			sameAnswers({ '1': { type: 'text', text: 'x' } }, { '1': { type: 'text', text: 'x' } })
		).toBe(true);
	});

	test('an added or dropped answer is a change', () => {
		expect(sameAnswers({}, { '1': { type: 'text', text: 'x' } })).toBe(false);
		expect(sameAnswers({ '1': { type: 'text', text: 'x' } }, {})).toBe(false);
		expect(sameAnswers({}, {})).toBe(true);
	});

	test('an option and "その他" never compare equal', () => {
		expect(
			sameAnswers(
				{ '1': { type: 'single', optionId: 'a' } },
				{ '1': { type: 'single', other: 'a' } }
			)
		).toBe(false);
	});
});

describe('describeAnswer', () => {
	const options = [
		{ id: 'a', label: 'りんご' },
		{ id: 'b', label: 'みかん' }
	];

	test('names options by label and falls back to the id', () => {
		expect(describeAnswer({ type: 'single', optionId: 'a' }, options)).toBe('りんご');
		expect(describeAnswer({ type: 'single', optionId: 'gone' }, options)).toBe('gone');
		expect(describeAnswer({ type: 'single', optionId: 'a' }, null)).toBe('a');
	});

	test('prefixes "その他" and lists multi answers in order', () => {
		expect(describeAnswer({ type: 'single', other: '梨' }, options)).toBe('その他: 梨');
		expect(describeAnswer({ type: 'multi', optionIds: ['b', 'a'] }, options)).toBe(
			'みかん、りんご'
		);
		expect(describeAnswer({ type: 'multi', optionIds: ['a'], other: '梨' }, options)).toBe(
			'りんご、その他: 梨'
		);
		expect(describeAnswer({ type: 'multi', optionIds: [], other: '梨' }, options)).toBe(
			'その他: 梨'
		);
	});

	test('shows text and dates as they are', () => {
		expect(describeAnswer({ type: 'text', text: 'こんにちは' }, null)).toBe('こんにちは');
		expect(describeAnswer({ type: 'date', date: '2026-09-29' }, null)).toBe('2026-09-29');
	});
});

describe('collectAnswerInputs', () => {
	const questions = [{ id: 1 }, { id: 2 }, { id: 3 }] as Question[];

	test('gathers every value, the "その他" text, and nothing for absent questions', () => {
		const data = new FormData();
		data.append('q_1', 'a');
		data.append('q_1', 'b');
		data.set('q_1_other', '自由記述');
		data.set('q_2', 'text');
		data.set('q_99', 'ignored');

		const inputs = collectAnswerInputs(data, questions);
		expect([...inputs.keys()]).toEqual([1, 2, 3]);
		expect(inputs.get(1)).toEqual({ values: ['a', 'b'], other: '自由記述' });
		expect(inputs.get(2)).toEqual({ values: ['text'], other: null });
		expect(inputs.get(3)).toEqual({ values: [], other: null });
	});

	test('drops uploaded files', () => {
		const data = new FormData();
		data.append('q_1', new File(['x'], 'x.txt'));
		data.append('q_1', 'a');
		data.set('q_1_other', new File(['y'], 'y.txt'));

		expect(collectAnswerInputs(data, questions).get(1)).toEqual({ values: ['a'], other: null });
	});
});
