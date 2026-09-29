import { describe, expect, test } from 'bun:test';
import {
	MAX_DESCRIPTION,
	MAX_FORM_BYTES,
	MAX_LABEL,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MAX_TITLE,
	OTHER_OPTION_ID,
	type InputErrorAt
} from '$lib/forms';
import { FormInputError, parseCreateFormPayload, parseQuestions } from '$lib/server/forms';
import { formOfSize, formTextBytes } from '../helpers/sizes';

const single = (options: unknown, extra: Record<string, unknown> = {}) => ({
	type: 'single',
	label: '質問',
	options,
	...extra
});

/** Checks the message and, when given, where the error is to be shown. */
const rejects = (fn: () => unknown, message: string | RegExp, at?: InputErrorAt | null) => {
	expect(fn).toThrow(FormInputError);
	expect(fn).toThrow(message);
	if (at === undefined) return;
	try {
		fn();
	} catch (err) {
		expect((err as FormInputError).at).toEqual(at);
	}
};

describe('parseQuestions', () => {
	test('rejects a missing, unreadable or empty payload, as the form’s own error', () => {
		rejects(() => parseQuestions(null), '質問を1つ以上追加してください', null);
		rejects(() => parseQuestions('   '), '質問を1つ以上追加してください', null);
		rejects(() => parseQuestions('{'), '質問データを読み取れませんでした', null);
		rejects(() => parseQuestions('[]'), '質問を1つ以上追加してください', null);
		rejects(() => parseQuestions('{"type":"text"}'), '質問を1つ以上追加してください', null);
	});

	test('caps the number of questions', () => {
		const many = Array.from({ length: MAX_QUESTIONS + 1 }, () => ({ type: 'text', label: 'q' }));
		rejects(() => parseQuestions(JSON.stringify(many)), `質問は${MAX_QUESTIONS}件までです`, null);
	});

	test('rejects an unknown type and a blank or overlong label', () => {
		rejects(() => parseQuestions(JSON.stringify([{ type: 'file', label: 'q' }])), /^種類が不正です$/, {
			question: 0
		});
		rejects(
			() => parseQuestions(JSON.stringify([{ type: 'text', label: '  ' }])),
			/^質問文を入力してください$/,
			{ question: 0 }
		);
		rejects(
			() => parseQuestions(JSON.stringify([{ type: 'text', label: 'x'.repeat(MAX_LABEL + 1) }])),
			`質問文は${MAX_LABEL}文字以内です`,
			{ question: 0 }
		);
	});

	test('trims text, and takes required and allowOther only when literally true', () => {
		const [text, choice] = parseQuestions(
			JSON.stringify([
				{ type: 'text', label: '  名前  ', helpText: '  ', required: 'yes', allowOther: true, options: [{ id: 'a', label: 'A' }] },
				single([{ id: ' a ', label: ' A ' }], { helpText: ' 補足 ', required: true, allowOther: true })
			])
		);
		expect(text).toEqual({
			type: 'text',
			label: '名前',
			helpText: null,
			required: false,
			options: null,
			allowOther: false
		});
		expect(choice).toEqual({
			type: 'single',
			label: '質問',
			helpText: '補足',
			required: true,
			options: [{ id: 'a', label: 'A' }],
			allowOther: true
		});
	});

	test('rejects the reserved "その他" option id', () => {
		rejects(
			() => parseQuestions(JSON.stringify([single([{ id: OTHER_OPTION_ID, label: 'その他' }])])),
			`選択肢の id「${OTHER_OPTION_ID}」は使えません`
		);
		rejects(
			() => parseQuestions(JSON.stringify([single([{ id: ` ${OTHER_OPTION_ID} `, label: 'x' }])])),
			'は使えません'
		);
	});

	test('validates choice options', () => {
		rejects(() => parseQuestions(JSON.stringify([single([])])), /^選択肢を1つ以上追加してください$/, {
			question: 0
		});
		rejects(() => parseQuestions(JSON.stringify([single(undefined)])), '選択肢を1つ以上追加してください');
		rejects(
			() => parseQuestions(JSON.stringify([single([{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }])])),
			'選択肢の id が重複しています'
		);
		rejects(() => parseQuestions(JSON.stringify([single([{ id: '', label: 'A' }])])), '選択肢の id がありません');
		rejects(() => parseQuestions(JSON.stringify([single([{ id: 'a', label: ' ' }])])), '選択肢のラベルを入力してください');
		const tooMany = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({ id: `o${i}`, label: `O${i}` }));
		rejects(() => parseQuestions(JSON.stringify([single(tooMany)])), `選択肢は${MAX_OPTIONS}個までです`);
	});

	test('locates the failing question by its place in the list', () => {
		rejects(
			() => parseQuestions(JSON.stringify([{ type: 'text', label: 'ok' }, single([])])),
			'選択肢を1つ以上追加してください',
			{ question: 1 }
		);
		rejects(
			() =>
				parseQuestions(
					JSON.stringify([
						{ type: 'text', label: 'ok' },
						single([{ id: 'a', label: 'A' }]),
						single([{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }])
					])
				),
			'選択肢の id が重複しています',
			{ question: 2 }
		);
	});
});

describe('parseCreateFormPayload', () => {
	const QUESTIONS = JSON.stringify([{ type: 'text', label: '名前' }]);

	const payload = (fields: Record<string, string>) => {
		const data = new FormData();
		for (const [key, value] of Object.entries({ title: 'タイトル', targetRoleId: '123', questions: QUESTIONS, ...fields })) {
			data.set(key, value);
		}
		return data;
	};

	test('fills in the defaults for omitted choices', () => {
		const parsed = parseCreateFormPayload(payload({ description: '  ' }));
		expect(parsed).toMatchObject({
			title: 'タイトル',
			description: null,
			targetRoleId: '123',
			submitScope: 'everyone',
			visibility: 'public',
			deadline: null,
			closesAt: null,
			allowEdit: false,
			announcementChannelId: null,
			announceClose: true
		});
		expect(parsed.questions).toHaveLength(1);
	});

	test('reads the choices that were sent', () => {
		const parsed = parseCreateFormPayload(
			payload({
				submitScope: 'target_role',
				visibility: 'after_deadline',
				allowEdit: 'on',
				announcementChannelId: '456',
				announceClose: 'off',
				deadline: '2099-01-02T09:00'
			})
		);
		expect(parsed.submitScope).toBe('target_role');
		expect(parsed.visibility).toBe('after_deadline');
		expect(parsed.allowEdit).toBe(true);
		expect(parsed.announcementChannelId).toBe('456');
		expect(parsed.announceClose).toBe(false);
		expect(parsed.deadline?.toISOString()).toBe('2099-01-02T00:00:00.000Z');
	});

	test('rejects values outside the enums, at their fields', () => {
		rejects(() => parseCreateFormPayload(payload({ visibility: 'everyone' })), '結果の公開範囲の値が不正です', {
			field: 'visibility'
		});
		rejects(() => parseCreateFormPayload(payload({ submitScope: 'admins' })), '提出できる人の値が不正です', {
			field: 'submitScope'
		});
	});

	test('requires a title and a target role within their limits', () => {
		rejects(() => parseCreateFormPayload(payload({ title: '  ' })), 'タイトルを入力してください', {
			field: 'title'
		});
		rejects(
			() => parseCreateFormPayload(payload({ title: 'x'.repeat(MAX_TITLE + 1) })),
			`タイトルは${MAX_TITLE}文字以内で入力してください`,
			{ field: 'title' }
		);
		rejects(() => parseCreateFormPayload(payload({ targetRoleId: '' })), '対象ロールを入力してください', {
			field: 'targetRoleId'
		});
		rejects(
			() => parseCreateFormPayload(payload({ description: 'x'.repeat(MAX_DESCRIPTION + 1) })),
			`説明は${MAX_DESCRIPTION}文字以内で入力してください`,
			{ field: 'description' }
		);
	});

	test('rejects malformed dates and a closes_at that has already passed', () => {
		rejects(() => parseCreateFormPayload(payload({ deadline: '2099-02-30T10:00' })), '締切の日時が不正です', {
			field: 'deadline'
		});
		rejects(
			() => parseCreateFormPayload(payload({ closesAt: '2000-01-01T00:00' })),
			'受付終了は現在より後の日時を指定してください',
			{ field: 'closesAt' }
		);
	});

	test('allows closing before the announced deadline', () => {
		const parsed = parseCreateFormPayload(
			payload({ deadline: '2099-01-10T00:00', closesAt: '2099-01-05T00:00' })
		);
		expect(parsed.closesAt!.getTime()).toBeLessThan(parsed.deadline!.getTime());
	});

	test('takes a form of exactly MAX_FORM_BYTES and refuses one byte more', () => {
		for (const char of ['あ', 'a', '"']) {
			const exact = formOfSize(MAX_FORM_BYTES, char);
			expect(formTextBytes(exact)).toBe(MAX_FORM_BYTES);
			expect(parseCreateFormPayload(payload(exact)).questions.length).toBeGreaterThan(0);

			const over = { ...exact, title: `${exact.title}a` };
			expect(formTextBytes(over)).toBe(MAX_FORM_BYTES + 1);
			rejects(() => parseCreateFormPayload(payload(over)), 'フォームが大きすぎます', null);
		}
	});
});
