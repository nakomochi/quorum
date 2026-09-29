import { describe, expect, test } from 'bun:test';
import {
	DRAFT_TEXT_LIMIT,
	draftPayload,
	MAX_DRAFT_LENGTH,
	questionsField,
	readDraftPayload
} from '../../src/lib/form-draft';
import {
	MAX_DESCRIPTION,
	MAX_HELP_TEXT,
	MAX_LABEL,
	MAX_OPTION_ID,
	MAX_OPTION_LABEL,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MAX_TITLE
} from '../../src/lib/forms';
import { copyTitle } from '../../src/lib/server/drafts';

describe('readDraftPayload', () => {
	test('reads back what the editor saved', () => {
		const questions = [
			{
				type: 'multi' as const,
				label: '日程',
				helpText: '複数可',
				required: true,
				options: [
					{ id: 'a', label: 'A' },
					{ id: 'b', label: 'B' }
				],
				allowOther: true
			}
		];
		const payload = draftPayload(
			{
				title: ['合宿'],
				description: ['説明'],
				targetRoleId: ['1'],
				announcementChannelId: ['2'],
				submitScope: ['target_role'],
				visibility: ['admin_only'],
				deadline: ['2026-10-01T12:00'],
				closesAt: ['2026-10-02T12:00'],
				allowEdit: ['on'],
				questions: [questionsField(questions)]
			},
			true
		);

		expect(readDraftPayload(JSON.parse(JSON.stringify(payload)))).toEqual({
			title: '合宿',
			description: '説明',
			targetRoleId: '1',
			announcementChannelId: '2',
			submitScope: 'target_role',
			visibility: 'admin_only',
			deadline: '2026-10-01T12:00',
			closesAt: '2026-10-02T12:00',
			allowEdit: true,
			closesAtTouched: true,
			questions
		});
	});

	test('an unchecked box is absent, and anything unreadable falls back to a default', () => {
		const state = readDraftPayload({
			v: 1,
			fields: {
				submitScope: ['nobody'],
				visibility: [42],
				questions: ['[{"type":"essay","options":[{"id":"x"},{"id":"x"},{"label":"no id"}]}, 7]']
			}
		});

		expect(state.allowEdit).toBe(false);
		expect(state.submitScope).toBe('everyone');
		expect(state.visibility).toBe('public');
		expect(state.questions).toEqual([
			{
				type: 'single',
				label: '',
				helpText: '',
				required: false,
				options: [{ id: 'x', label: '' }],
				allowOther: false
			}
		]);
	});

	test('a payload that is not a draft at all gives the empty editor', () => {
		for (const junk of [null, 'text', [], { v: 99 }, { fields: [] }]) {
			const state = readDraftPayload(junk);
			expect(state.title).toBe('');
			expect(state.allowEdit).toBe(true);
			expect(state.questions).toEqual([]);
		}
	});
});

describe('size limit', () => {
	test('the largest valid form fits, with room to spare', () => {
		const long = (n: number) => 'あ'.repeat(n);
		const questions = Array.from({ length: MAX_QUESTIONS }, (_, q) => ({
			type: 'single' as const,
			label: long(MAX_LABEL),
			helpText: long(MAX_HELP_TEXT),
			required: true,
			options: Array.from({ length: MAX_OPTIONS }, (_, o) => ({
				id: `${q}-${o}`.padEnd(MAX_OPTION_ID, 'x'),
				label: long(MAX_OPTION_LABEL)
			})),
			allowOther: true
		}));
		const payload = draftPayload(
			{
				title: [long(MAX_TITLE)],
				description: [long(MAX_DESCRIPTION)],
				targetRoleId: ['900000000000000001'],
				announcementChannelId: ['900000000000000002'],
				submitScope: ['target_role'],
				visibility: ['after_deadline'],
				deadline: ['2026-10-01T12:00'],
				closesAt: ['2026-10-02T12:00'],
				allowEdit: ['on'],
				questions: [questionsField(questions)]
			},
			true
		);
		const body = JSON.stringify({ version: 1, payload });

		expect(DRAFT_TEXT_LIMIT).toBe(1_474_200);
		expect(body.length).toBeGreaterThan(DRAFT_TEXT_LIMIT);
		expect(body.length).toBeLessThan(MAX_DRAFT_LENGTH);
	});
});

describe('copyTitle', () => {
	test('appends のコピー and stays within the title limit', () => {
		expect(copyTitle('合宿')).toBe('合宿のコピー');
		const copied = copyTitle('x'.repeat(MAX_TITLE));
		expect(copied).toHaveLength(MAX_TITLE);
		expect(copied.endsWith('のコピー')).toBe(true);
	});
});
