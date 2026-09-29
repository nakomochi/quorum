import { describe, expect, test } from 'bun:test';
import {
	draftPayload,
	MAX_DRAFT_BYTES,
	questionsField,
	readDraftPayload
} from '../../src/lib/form-draft';
import { MAX_FORM_BYTES, MAX_TITLE, utf8Bytes } from '../../src/lib/forms';
import { copyTitle } from '../../src/lib/server/drafts';
import { formOfSize } from '../helpers/sizes';

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
	/** The body the editor would send for a form of exactly MAX_FORM_BYTES made of `char`. */
	function draftBodyBytes(char: string) {
		const text = formOfSize(MAX_FORM_BYTES, char);
		const payload = draftPayload(
			{
				title: [text.title],
				description: [text.description],
				targetRoleId: ['900000000000000001'],
				announcementChannelId: ['900000000000000002'],
				submitScope: ['target_role'],
				visibility: ['after_deadline'],
				deadline: ['2026-10-01T12:00'],
				closesAt: ['2026-10-02T12:00'],
				allowEdit: ['on'],
				questions: [text.questions]
			},
			true
		);
		return utf8Bytes(JSON.stringify({ version: 2_147_483_647, payload }));
	}

	test('the draft of any form within MAX_FORM_BYTES fits, escaping included', () => {
		const japanese = draftBodyBytes('あ');
		// Quotes are the worst case: every one is escaped once more in the draft.
		const quotes = draftBodyBytes('"');

		expect(japanese).toBeLessThan(MAX_FORM_BYTES * 1.1);
		expect(quotes).toBeGreaterThan(MAX_FORM_BYTES * 1.9);
		expect(quotes).toBeLessThanOrEqual(MAX_DRAFT_BYTES);
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
