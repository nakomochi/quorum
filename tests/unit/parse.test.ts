import { describe, expect, test } from 'bun:test';
import {
	MAX_LABEL,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MAX_TITLE,
	OTHER_OPTION_ID
} from '$lib/forms';
import { FormInputError, parseCreateFormPayload, parseQuestions } from '$lib/server/forms';

const single = (options: unknown, extra: Record<string, unknown> = {}) => ({
	type: 'single',
	label: '質問',
	options,
	...extra
});

const rejects = (fn: () => unknown, message: string | RegExp) => {
	expect(fn).toThrow(FormInputError);
	expect(fn).toThrow(message);
};

describe('parseQuestions', () => {
	test('rejects a missing, unreadable or empty payload', () => {
		rejects(() => parseQuestions(null), '質問を1つ以上追加してください');
		rejects(() => parseQuestions('   '), '質問を1つ以上追加してください');
		rejects(() => parseQuestions('{'), '質問データを読み取れませんでした');
		rejects(() => parseQuestions('[]'), '質問を1つ以上追加してください');
		rejects(() => parseQuestions('{"type":"text"}'), '質問を1つ以上追加してください');
	});

	test('caps the number of questions', () => {
		const many = Array.from({ length: MAX_QUESTIONS + 1 }, () => ({ type: 'text', label: 'q' }));
		rejects(() => parseQuestions(JSON.stringify(many)), `質問は${MAX_QUESTIONS}件までです`);
	});

	test('rejects an unknown type and a blank or overlong label', () => {
		rejects(() => parseQuestions(JSON.stringify([{ type: 'file', label: 'q' }])), '質問1: 種類が不正です');
		rejects(() => parseQuestions(JSON.stringify([{ type: 'text', label: '  ' }])), '質問1: 質問文を入力してください');
		rejects(
			() => parseQuestions(JSON.stringify([{ type: 'text', label: 'x'.repeat(MAX_LABEL + 1) }])),
			`質問1: 質問文は${MAX_LABEL}文字以内です`
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
		rejects(() => parseQuestions(JSON.stringify([single([])])), '質問1: 選択肢を1つ以上追加してください');
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

	test('numbers the failing question in the message', () => {
		rejects(
			() => parseQuestions(JSON.stringify([{ type: 'text', label: 'ok' }, single([])])),
			'質問2: 選択肢を1つ以上追加してください'
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
			announcementChannelId: null
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
				deadline: '2099-01-02T09:00'
			})
		);
		expect(parsed.submitScope).toBe('target_role');
		expect(parsed.visibility).toBe('after_deadline');
		expect(parsed.allowEdit).toBe(true);
		expect(parsed.announcementChannelId).toBe('456');
		expect(parsed.deadline?.toISOString()).toBe('2099-01-02T00:00:00.000Z');
	});

	test('rejects values outside the enums', () => {
		rejects(() => parseCreateFormPayload(payload({ visibility: 'everyone' })), '結果の公開範囲の値が不正です');
		rejects(() => parseCreateFormPayload(payload({ submitScope: 'admins' })), '提出できる人の値が不正です');
	});

	test('requires a title and a target role within their limits', () => {
		rejects(() => parseCreateFormPayload(payload({ title: '  ' })), 'タイトルを入力してください');
		rejects(
			() => parseCreateFormPayload(payload({ title: 'x'.repeat(MAX_TITLE + 1) })),
			`タイトルは${MAX_TITLE}文字以内で入力してください`
		);
		rejects(() => parseCreateFormPayload(payload({ targetRoleId: '' })), '対象ロールを入力してください');
	});

	test('rejects malformed dates and a closes_at that has already passed', () => {
		rejects(() => parseCreateFormPayload(payload({ deadline: '2099-02-30T10:00' })), '締切の日時が不正です');
		rejects(() => parseCreateFormPayload(payload({ closesAt: '2000-01-01T00:00' })), '受付終了は現在より後の日時を指定してください');
	});

	test('allows closing before the announced deadline', () => {
		const parsed = parseCreateFormPayload(
			payload({ deadline: '2099-01-10T00:00', closesAt: '2099-01-05T00:00' })
		);
		expect(parsed.closesAt!.getTime()).toBeLessThan(parsed.deadline!.getTime());
	});
});
