import { describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { answer, response, responseRevision } from '$lib/server/db/schema';
import { closeForm, FormInputError, loadOwnResponse, type QuestionDraft } from '$lib/server/forms';
import { MAX_OTHER_ANSWER, MAX_RESPONSE_BYTES, MAX_TEXT_ANSWER, OTHER_OPTION_ID } from '$lib/forms';
import { OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUser,
	inputs,
	makeForm,
	member,
	patchForm,
	seedGuild,
	snowflake,
	submit
} from '../helpers/fixtures';

async function counts(formId: string) {
	const [row] = await db.$client<{ responses: number; revisions: number; answers: number }[]>`
		select
			(select count(*)::int from response where form_id = ${formId}) as responses,
			(select count(*)::int from response_revision rr join response r on r.id = rr.response_id where r.form_id = ${formId}) as revisions,
			(select count(*)::int from answer a join response r on r.id = a.response_id where r.form_id = ${formId}) as answers`;
	return row;
}

async function setup() {
	const creator = await createUser(snowflake(1));
	const who = await createUser(snowflake(2));
	await seedGuild([member(creator.discordId), member(who.discordId)]);
	return { creator, who };
}

describe('submitResponse: versions', () => {
	test('the first submission creates the response and one revision', async () => {
		const { creator, who } = await setup();
		const { id, questions } = await makeForm(creator);

		const result = await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '山田', 1: 'yes' }));

		expect(result).toMatchObject({ ok: true, created: true });
		expect(await counts(id)).toEqual({ responses: 1, revisions: 1, answers: 2 });
		const own = await loadOwnResponse(id, who.id);
		expect(own?.answers.map((a) => a.value).sort((a, b) => a.type.localeCompare(b.type))).toEqual([
			{ type: 'single', optionId: 'yes' },
			{ type: 'text', text: '山田' }
		]);
	});

	test('an edit adds a revision, replaces the answers and moves updated_at', async () => {
		const { creator, who } = await setup();
		const { id, questions } = await makeForm(creator);
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '山田', 1: 'yes' }));

		const edited = await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '山田' }));

		expect(edited).toMatchObject({ ok: true, created: false });
		expect(await counts(id)).toEqual({ responses: 1, revisions: 2, answers: 1 });
		const [row] = await db
			.select({ moved: sql<boolean>`${response.updatedAt} > ${response.submittedAt}` })
			.from(response)
			.where(eq(response.formId, id));
		expect(row.moved).toBe(true);
	});

	test('resubmitting the same content adds no revision and keeps updated_at', async () => {
		const { creator, who } = await setup();
		const { id, questions } = await makeForm(creator, {
			questions: [
				{ type: 'text', label: 't', helpText: null, required: true, options: null, allowOther: false },
				{
					type: 'multi',
					label: 'm',
					helpText: null,
					required: false,
					options: [
						{ id: 'a', label: 'A' },
						{ id: 'b', label: 'B' }
					],
					allowOther: true
				}
			]
		});
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: 'hello', 1: { values: ['a', 'b', OTHER_OPTION_ID], other: '他' } }));
		const [before] = await db.select().from(response).where(eq(response.formId, id));

		const again = await submit(
			id,
			who,
			[TARGET_ROLE],
			inputs(questions, { 0: '  hello  ', 1: { values: [OTHER_OPTION_ID, 'b', 'a', 'b'], other: ' 他 ' } })
		);

		expect(again).toMatchObject({ ok: true, created: false });
		expect(await counts(id)).toMatchObject({ responses: 1, revisions: 1 });
		const [after] = await db.select().from(response).where(eq(response.formId, id));
		expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
	});

	test('with editing off, a second submission is refused', async () => {
		const { creator, who } = await setup();
		const { id, questions } = await makeForm(creator, { allowEdit: false });
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: 'a' }));

		expect(await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: 'b' }))).toEqual({
			ok: false,
			reason: 'already_submitted'
		});
		expect(await counts(id)).toMatchObject({ responses: 1, revisions: 1 });
	});
});

describe('submitResponse: gates', () => {
	test('unknown form', async () => {
		const { who } = await setup();
		expect(await submit('missing', who, [TARGET_ROLE], new Map())).toEqual({ ok: false, reason: 'not_found' });
	});

	test('a closed form refuses, whether closed by hand or by closes_at', async () => {
		const { creator, who } = await setup();
		const manual = await makeForm(creator);
		expect((await closeForm(manual.id)).ok).toBe(true);
		expect(await submit(manual.id, who, [TARGET_ROLE], inputs(manual.questions, { 0: 'a' }))).toEqual({
			ok: false,
			reason: 'closed'
		});

		const timed = await makeForm(creator);
		await patchForm(timed.id, { closesAt: new Date(Date.now() - 1000) });
		expect(await submit(timed.id, who, [TARGET_ROLE], inputs(timed.questions, { 0: 'a' }))).toEqual({
			ok: false,
			reason: 'closed'
		});
		expect(await counts(manual.id)).toMatchObject({ responses: 0 });
		expect(await counts(timed.id)).toMatchObject({ responses: 0 });
	});

	test('target_role is judged by the roles passed in, not by the mirror', async () => {
		const creator = await createUser(snowflake(1));
		const mirroredWithRole = await createUser(snowflake(2));
		const mirroredWithout = await createUser(snowflake(3));
		await seedGuild([
			member(creator.discordId),
			member(mirroredWithRole.discordId, [TARGET_ROLE]),
			member(mirroredWithout.discordId, [OTHER_ROLE])
		]);
		const { id, questions } = await makeForm(creator, { submitScope: 'target_role' });

		expect(await submit(id, mirroredWithRole, [OTHER_ROLE], inputs(questions, { 0: 'a' }))).toEqual({
			ok: false,
			reason: 'forbidden'
		});
		expect(await submit(id, mirroredWithout, [TARGET_ROLE], inputs(questions, { 0: 'a' }))).toMatchObject({
			ok: true,
			created: true
		});
	});
});

describe('submitResponse: building answers', () => {
	async function formWith(questions: QuestionDraft[]) {
		const { creator, who } = await setup();
		const made = await makeForm(creator, { questions });
		return { ...made, who };
	}

	const choice = (type: 'single' | 'multi', allowOther: boolean, required = false) => ({
		type,
		label: type === 'single' ? '単一' : '複数',
		helpText: null,
		required,
		options: [
			{ id: 'a', label: 'A' },
			{ id: 'b', label: 'B' }
		],
		allowOther
	});
	const text = (required: boolean) => ({
		type: 'text' as const,
		label: '記述',
		helpText: null,
		required,
		options: null,
		allowOther: false
	});

	/** Refused with exactly `message`, shown in the card of the question with `questionId`. */
	async function refusedAt(pending: Promise<unknown>, message: string, questionId: number) {
		const err = await pending.then(
			() => null,
			(e: unknown) => e
		);
		expect(err).toBeInstanceOf(FormInputError);
		expect((err as FormInputError).message).toBe(message);
		expect((err as FormInputError).at).toEqual({ questionId });
	}

	async function stored(formId: string) {
		const rows = await db
			.select({ questionId: answer.questionId, value: answer.value })
			.from(answer)
			.innerJoin(response, eq(response.id, answer.responseId))
			.where(eq(response.formId, formId));
		return rows.map((row) => row.value);
	}

	test('a required question left blank, or only whitespace, is refused', async () => {
		const { id, questions, who } = await formWith([text(true)]);
		await refusedAt(submit(id, who, [], inputs(questions, {})), 'この質問は必須です', questions[0].id);
		await refusedAt(
			submit(id, who, [], inputs(questions, { 0: '   ' })),
			'この質問は必須です',
			questions[0].id
		);
		expect(await counts(id)).toMatchObject({ responses: 0 });
	});

	test('optional questions left blank are not stored', async () => {
		const { id, questions, who } = await formWith([text(false), choice('single', false)]);
		expect(await submit(id, who, [], inputs(questions, {}))).toMatchObject({ ok: true });
		expect(await counts(id)).toEqual({ responses: 1, revisions: 1, answers: 0 });
	});

	test('"その他" with allowOther stores the trimmed text', async () => {
		const { id, questions, who } = await formWith([choice('single', true), choice('multi', true)]);
		await submit(
			id,
			who,
			[],
			inputs(questions, {
				0: { values: [OTHER_OPTION_ID], other: '  自由  ' },
				1: { values: ['b', OTHER_OPTION_ID, 'b'], other: 'ほか' }
			})
		);
		expect(await stored(id)).toEqual(
			expect.arrayContaining([
				{ type: 'single', other: '自由' },
				{ type: 'multi', optionIds: ['b'], other: 'ほか' }
			])
		);
	});

	test('"その他" text without choosing it is dropped', async () => {
		const { id, questions, who } = await formWith([choice('single', true)]);
		await submit(id, who, [], inputs(questions, { 0: { values: ['a'], other: '選ばれていない' } }));
		expect(await stored(id)).toEqual([{ type: 'single', optionId: 'a' }]);
	});

	test('"その他" chosen but empty, or too long, is refused', async () => {
		const { id, questions, who } = await formWith([choice('single', true)]);
		await refusedAt(
			submit(id, who, [], inputs(questions, { 0: { values: [OTHER_OPTION_ID], other: '  ' } })),
			'「その他」の内容を入力してください',
			questions[0].id
		);
		await refusedAt(
			submit(id, who, [], inputs(questions, { 0: { values: [OTHER_OPTION_ID], other: 'x'.repeat(MAX_OTHER_ANSWER + 1) } })),
			`「その他」は${MAX_OTHER_ANSWER}文字以内で入力してください`,
			questions[0].id
		);
	});

	test('"その他" sent to a question that does not offer it is refused', async () => {
		const { id, questions, who } = await formWith([choice('single', false), choice('multi', false)]);
		await refusedAt(
			submit(id, who, [], inputs(questions, { 0: { values: [OTHER_OPTION_ID], other: 'x' } })),
			'選択肢が不正です',
			questions[0].id
		);
		await refusedAt(
			submit(id, who, [], inputs(questions, { 1: { values: ['a', OTHER_OPTION_ID], other: 'x' } })),
			'選択肢が不正です',
			questions[1].id
		);
		expect(await counts(id)).toMatchObject({ responses: 0 });
	});

	test('an option id the question does not have is refused', async () => {
		const { id, questions, who } = await formWith([choice('single', false), choice('multi', false)]);
		await refusedAt(submit(id, who, [], inputs(questions, { 0: 'zzz' })), '選択肢が不正です', questions[0].id);
		await refusedAt(
			submit(id, who, [], inputs(questions, { 1: ['a', 'zzz'] })),
			'選択肢が不正です',
			questions[1].id
		);
	});

	test('text is capped at its maximum length', async () => {
		const { id, questions, who } = await formWith([text(false)]);
		await refusedAt(
			submit(id, who, [], inputs(questions, { 0: 'x'.repeat(MAX_TEXT_ANSWER + 1) })),
			`${MAX_TEXT_ANSWER}文字以内で入力してください`,
			questions[0].id
		);
		expect(await submit(id, who, [], inputs(questions, { 0: 'x'.repeat(MAX_TEXT_ANSWER) }))).toMatchObject({ ok: true });
	});

	test('a response of exactly MAX_RESPONSE_BYTES is taken, and one byte more is refused', async () => {
		const { id, questions, who } = await formWith([
			...Array.from({ length: 5 }, () => text(false)),
			choice('single', true)
		]);
		// Four full Japanese answers of 12,000 bytes each, the choice 'a', and "その他" text that
		// was sent unchosen: it counts even though it is dropped.
		const full = 'あ'.repeat(MAX_TEXT_ANSWER);
		const other = 'x'.repeat(MAX_OTHER_ANSWER);
		const rest = MAX_RESPONSE_BYTES - 4 * 3 * MAX_TEXT_ANSWER - 1 - MAX_OTHER_ANSWER;
		const answers = (last: string) =>
			inputs(questions, { 0: full, 1: full, 2: full, 3: full, 4: last, 5: { values: ['a'], other } });

		const tooLarge = await submit(id, who, [], answers('x'.repeat(rest + 1))).catch((e: unknown) => e);
		expect(tooLarge).toBeInstanceOf(FormInputError);
		// Nothing to point at but the form as a whole.
		expect((tooLarge as FormInputError).detail).toEqual({
			message: '回答が大きすぎます。入力を短くしてください',
			at: null
		});
		expect(await counts(id)).toMatchObject({ responses: 0 });
		expect(await submit(id, who, [], answers('x'.repeat(rest)))).toMatchObject({ ok: true });
	});

	test('dates must be real calendar dates', async () => {
		const { id, questions, who } = await formWith([
			{ type: 'date', label: '日付', helpText: null, required: false, options: null, allowOther: false }
		]);
		await refusedAt(submit(id, who, [], inputs(questions, { 0: '2026/09/29' })), '日付が不正です', questions[0].id);
		await refusedAt(submit(id, who, [], inputs(questions, { 0: '2026-13-01' })), '日付が不正です', questions[0].id);
		expect(await submit(id, who, [], inputs(questions, { 0: '2026-09-29' }))).toMatchObject({ ok: true });
		expect(await stored(id)).toEqual([{ type: 'date', date: '2026-09-29' }]);
	});

	test('revision snapshots carry exactly what was stored', async () => {
		const { id, questions, who } = await formWith([text(false), choice('multi', false)]);
		await submit(id, who, [], inputs(questions, { 0: ' hi ', 1: ['b', 'a'] }));
		const [revision] = await db.select().from(responseRevision);
		expect(revision.answers).toEqual({
			[String(questions[0].id)]: { type: 'text', text: 'hi' },
			[String(questions[1].id)]: { type: 'multi', optionIds: ['b', 'a'] }
		});
	});
});
