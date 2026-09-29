import { describe, expect, test } from 'bun:test';
import { OTHER_OPTION_ID, type RevisionAnswers } from '../../src/lib/forms';
import {
	answersFromFields,
	draftDiffers,
	readResponseDraft,
	type DraftQuestion
} from '../../src/lib/response-draft';

const QUESTIONS: DraftQuestion[] = [
	{ id: 1, type: 'single', options: [{ id: 'yes' }, { id: 'no' }], allowOther: true },
	{ id: 2, type: 'multi', options: [{ id: 'a' }, { id: 'b' }], allowOther: true },
	{ id: 3, type: 'text', options: null, allowOther: false },
	{ id: 4, type: 'date', options: null, allowOther: false }
];

function fields(entries: [string, string][]) {
	const data = new FormData();
	for (const [name, value] of entries) data.append(name, value);
	return data;
}

describe('answersFromFields', () => {
	test('keeps what the fields hold, untrimmed, and leaves blank questions out', () => {
		const answers = answersFromFields(
			fields([
				['q_1', 'yes'],
				['q_1_other', '選んでいないその他'],
				['q_2', 'b'],
				['q_2', OTHER_OPTION_ID],
				['q_2_other', ' 途中 '],
				['q_3', '  書きかけ\n'],
				['q_4', '']
			]),
			QUESTIONS
		);

		expect(answers).toEqual({
			1: { type: 'single', optionId: 'yes' },
			2: { type: 'multi', optionIds: ['b'], other: ' 途中 ' },
			3: { type: 'text', text: '  書きかけ\n' }
		});
	});

	test('a chosen "その他" with nothing typed yet is kept as empty', () => {
		const answers = answersFromFields(fields([['q_1', OTHER_OPTION_ID]]), QUESTIONS);

		expect(answers).toEqual({ 1: { type: 'single', other: '' } });
	});
});

describe('readResponseDraft', () => {
	test('reads back only what fits today’s questions', () => {
		const stored = {
			1: { type: 'single', optionId: 'gone' },
			2: { type: 'multi', optionIds: ['a', 'gone', 'a', 7], other: 'x' },
			3: { type: 'date', date: '2026-05-02' },
			4: { type: 'date', date: '2026-05-03' },
			99: { type: 'text', text: '消えた質問' },
			extra: 'junk'
		};

		expect(readResponseDraft(stored, QUESTIONS)).toEqual({
			2: { type: 'multi', optionIds: ['a'], other: 'x' },
			4: { type: 'date', date: '2026-05-03' }
		});
	});

	test('anything unreadable is an empty draft', () => {
		expect(readResponseDraft(null, QUESTIONS)).toEqual({});
		expect(readResponseDraft([1, 2], QUESTIONS)).toEqual({});
		expect(readResponseDraft('text', QUESTIONS)).toEqual({});
	});

	test('"その他" is dropped where the question no longer offers it', () => {
		const closedOther = QUESTIONS.map((q) => ({ ...q, allowOther: false }));

		expect(
			readResponseDraft({ 1: { type: 'single', other: 'x' }, 2: { type: 'multi', optionIds: [], other: 'y' } }, closedOther)
		).toEqual({});
	});
});

describe('draftDiffers', () => {
	const submitted: RevisionAnswers = {
		2: { type: 'multi', optionIds: ['a', 'b'] },
		3: { type: 'text', text: '山田' }
	};

	test('whitespace a submission would trim, and the order of choices, are no change', () => {
		expect(
			draftDiffers(
				{
					2: { type: 'multi', optionIds: ['b', 'a'] },
					3: { type: 'text', text: '  山田\n' },
					4: { type: 'date', date: ' ' }
				},
				submitted
			)
		).toBe(false);
	});

	test('a changed, added or removed answer is a change', () => {
		expect(draftDiffers({ ...submitted, 3: { type: 'text', text: '田中' } }, submitted)).toBe(true);
		expect(draftDiffers({ ...submitted, 4: { type: 'date', date: '2026-05-02' } }, submitted)).toBe(true);
		expect(draftDiffers({ 3: submitted[3] }, submitted)).toBe(true);
	});

	test('an empty draft matches no answers, and a chosen empty "その他" is a change', () => {
		expect(draftDiffers({}, {})).toBe(false);
		expect(draftDiffers({ 1: { type: 'single', other: ' ' } }, {})).toBe(true);
	});
});
