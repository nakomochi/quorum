import { describe, expect, test } from 'bun:test';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { and, eq, isNotNull } from 'drizzle-orm';
import { toJstLocal } from '$lib/datetime';
import { draftPayload, questionsField, type EditorState } from '$lib/form-draft';
import {
	AUDIENCE_LOCKED,
	CHANNEL_LOCKED,
	describeAnswer,
	TYPE_LOCKED,
	type RevisionAnswers
} from '$lib/forms';
import { resultTable } from '$lib/results-table';
import { db } from '$lib/server/db';
import { form, formDraft, question, response, responseRevision } from '$lib/server/db/schema';
import { updateDraft } from '$lib/server/drafts';
import { openEditDraft } from '$lib/server/form-edit';
import { closeForm, loadForm, loadQuestions } from '$lib/server/forms';
import { announceForm, sendReminder } from '$lib/server/notify';
import { saveResponseDraft } from '$lib/server/response-drafts';
import { load as topLoad } from '../../src/routes/+page.server';
import { actions as formActions, load as formLoad } from '../../src/routes/forms/[id]/+page.server';
import { actions as editActions, load as editLoad } from '../../src/routes/forms/[id]/edit/+page.server';
import { load as resultsLoad } from '../../src/routes/forms/[id]/results/+page.server';
import { load as historyLoad } from '../../src/routes/forms/[id]/results/[responseId]/+page.server';
import { GET as csv } from '../../src/routes/forms/[id]/results/csv/+server';
import { load as newLoad } from '../../src/routes/forms/new/+page.server';
import { ADMIN_ROLE, CHANNEL_ID, discord, OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	seedGuild,
	sessionLocals,
	settle,
	sleep,
	snowflake,
	submit,
	withSlowWrites,
	type TestUser
} from '../helpers/fixtures';

const ORIGIN = 'http://forms.test';

const STALE = 'ほかの人が先に変更を公開しました。最新の内容を読み込み直してください。';
const CLOSED = 'このフォームは確定済みのため編集できません。受付を再開してから編集してください。';
const FORM_CHANGED = 'フォームが更新されました。内容を確認してからもう一度送信してください。';

const QUESTIONS = [
	{ type: 'text' as const, label: '名前', helpText: null, required: true, options: null, allowOther: false },
	{
		type: 'single' as const,
		label: '参加',
		helpText: null,
		required: false,
		options: [
			{ id: 'yes', label: '出席' },
			{ id: 'no', label: '欠席' }
		],
		allowOther: false
	},
	{ type: 'text' as const, label: 'メモ', helpText: null, required: false, options: null, allowOther: false }
];

async function setup() {
	const [creator, answerer, other, admin] = await createUsers([1, 2, 3, 4].map(snowflake));
	await seedGuild([
		member(creator.discordId, [OTHER_ROLE]),
		member(answerer.discordId, [TARGET_ROLE]),
		member(other.discordId, [TARGET_ROLE]),
		member(admin.discordId, [ADMIN_ROLE])
	]);
	const made = await makeForm(creator, { questions: QUESTIONS });
	return { creator, answerer, other, admin, ...made };
}

const event = (who: TestUser, id: string, path = `/forms/${id}/edit`) =>
	({ locals: sessionLocals(who), params: { id }, url: new URL(`${ORIGIN}${path}`) }) as never;

type EditData = Exclude<Awaited<ReturnType<typeof editLoad>>, void>;
type Editor = NonNullable<EditData['editor']>;

async function openEdit(who: TestUser, id: string): Promise<EditData> {
	return (await editLoad(event(who, id))) as EditData;
}

async function editorOf(who: TestUser, id: string): Promise<Editor> {
	const data = await openEdit(who, id);
	if (!data.editor) throw new Error('the edit page is not editable');
	return data.editor;
}

type Outcome = { status: number; location?: string; data?: unknown };

/** Runs a page action as SvelteKit would, turning a redirect, failure or error into its status. */
async function act(
	run: (event: never) => unknown,
	who: TestUser,
	id: string,
	body: FormData = new FormData(),
	path = `/forms/${id}/edit`
): Promise<Outcome> {
	const request = new Request(`${ORIGIN}${path}`, { method: 'POST', body });
	try {
		const result = await run({
			locals: sessionLocals(who),
			params: { id },
			request,
			url: new URL(request.url)
		} as never);
		if (isActionFailure(result)) return { status: result.status, data: result.data };
		return { status: 200, data: result };
	} catch (e) {
		if (isRedirect(e)) return { status: e.status, location: e.location };
		if (isHttpError(e)) return { status: e.status, data: e.body };
		throw e;
	}
}

/** What the editor posts for `state`. */
function publishBody(state: EditorState, baseVersion: number): FormData {
	const data = new FormData();
	for (const name of [
		'title',
		'description',
		'targetRoleId',
		'announcementChannelId',
		'submitScope',
		'visibility',
		'deadline',
		'closesAt'
	] as const) {
		data.set(name, state[name]);
	}
	data.set('announceClose', state.announceClose ? 'on' : 'off');
	if (state.allowEdit) data.set('allowEdit', 'on');
	data.set('questions', questionsField(state.questions));
	data.set('baseVersion', String(baseVersion));
	return data;
}

/** Opens the edit page as `who`, changes what the editor holds, and publishes it. */
async function edit(who: TestUser, id: string, change: (state: EditorState) => void): Promise<Outcome> {
	const editor = await editorOf(who, id);
	const state = structuredClone(editor.draft.state);
	change(state);
	return act(editActions.publish, who, id, publishBody(state, editor.baseVersion));
}

const published = (id: string): Outcome => ({ status: 303, location: `/forms/${id}/results?published=1` });

async function editDrafts(formId: string) {
	return db.select().from(formDraft).where(eq(formDraft.formId, formId));
}

async function allQuestions(formId: string) {
	return db.select().from(question).where(eq(question.formId, formId)).orderBy(question.id);
}

describe('opening the edit page', () => {
	test('the form as the editor holds it, in one draft of the viewer’s own', async () => {
		const { creator, id, questions } = await setup();
		const deadline = new Date('2026-12-01T03:00:00Z');
		await db.update(form).set({ deadline, closesAt: deadline, description: '説明' }).where(eq(form.id, id));

		const editor = await editorOf(creator, id);

		expect(editor.draft.state).toEqual({
			title: 'テストフォーム',
			description: '説明',
			targetRoleId: TARGET_ROLE,
			announcementChannelId: '',
			announceClose: true,
			submitScope: 'everyone',
			visibility: 'public',
			deadline: toJstLocal(deadline),
			closesAt: toJstLocal(deadline),
			allowEdit: true,
			// Equal to the deadline, so it keeps following it.
			closesAtTouched: false,
			questions: questions.map((q) => ({
				sourceId: q.id,
				type: q.type,
				label: q.label,
				helpText: '',
				required: q.required,
				options: q.options ?? [],
				allowOther: q.allowOther
			}))
		});
		expect(editor.baseVersion).toBe(1);
		expect(editor.stale).toBe(false);
		expect(editor.resumed).toBe(false);
		expect(editor.locks).toEqual({ audience: false, questionTypes: false, channel: false });

		const again = await editorOf(creator, id);
		expect(again.draft.id).toBe(editor.draft.id);
		const rows = await editDrafts(id);
		expect(rows.map((row) => [row.createdBy, row.baseVersion])).toEqual([[creator.id, 1]]);
	});

	test('the edit draft is neither listed on the top page nor opened by the creation page', async () => {
		const { creator, id } = await setup();
		const editor = await editorOf(creator, id);

		const top = (await topLoad(event(creator, id, '/'))) as { drafts: unknown[] };
		expect(top.drafts).toEqual([]);

		let status: number | 'ok' = 'ok';
		try {
			await newLoad({
				locals: sessionLocals(creator),
				url: new URL(`${ORIGIN}/forms/new?draft=${editor.draft.id}`)
			} as never);
		} catch (e) {
			status = isHttpError(e) ? e.status : -1;
		}
		expect(status).toBe(404);
	});

	test('one edit draft per form and person, however many openings race', async () => {
		const { creator, admin, id } = await setup();
		const target = (await loadForm(id))!;

		const opened = await Promise.all(Array.from({ length: 5 }, () => openEditDraft(target, creator.id)));
		await openEditDraft(target, admin.id);

		expect(new Set(opened.map((draft) => draft.id)).size).toBe(1);
		expect((await editDrafts(id)).map((row) => row.createdBy).sort()).toEqual([creator.id, admin.id].sort());

		const duplicate = await settle(
			db.insert(formDraft).values({
				createdBy: creator.id,
				formId: id,
				baseVersion: 1,
				payload: draftPayload({}, false)
			})
		);
		expect(duplicate.ok ? 'inserted' : duplicate.code).toBe('23505');
	});

	test('a saved edit is resumed, with a lock that came since put back as published', async () => {
		const { creator, answerer, id, questions } = await setup();
		const editor = await editorOf(creator, id);
		const changed = structuredClone(editor.draft.state);
		changed.title = '途中の変更';
		changed.targetRoleId = OTHER_ROLE;
		changed.questions[0].type = 'date';
		const fields = Object.fromEntries([...publishBody(changed, 1)].map(([name, value]) => [name, [String(value)]]));
		const saved = await updateDraft(editor.draft.id, creator.id, editor.draft.version, draftPayload(fields, false));
		expect(saved.ok).toBe(true);

		await submit(id, answerer, [TARGET_ROLE], inputs(questions, { 0: '山田' }));
		const resumed = await editorOf(creator, id);

		expect(resumed.resumed).toBe(true);
		expect(resumed.locks).toEqual({ audience: true, questionTypes: true, channel: false });
		expect(resumed.draft.state.title).toBe('途中の変更');
		expect(resumed.draft.state.targetRoleId).toBe(TARGET_ROLE);
		expect(resumed.draft.state.questions[0].type).toBe('text');
	});

	test('a closed form says to reopen it, and starts no edit', async () => {
		const { creator, id } = await setup();
		await closeForm(id);
		discord.calls = [];

		const data = await openEdit(creator, id);

		expect(data).toEqual({ form: { id, title: 'テストフォーム' }, closed: true, editor: null });
		expect(await editDrafts(id)).toEqual([]);
		expect(discord.count()).toBe(0);
	});

	test('only the creator and admins may open, publish or reload', async () => {
		const { other, admin, id } = await setup();

		expect((await openEdit(admin, id)).editor).not.toBeNull();

		let status: number | 'ok' = 'ok';
		try {
			await openEdit(other, id);
		} catch (e) {
			status = isHttpError(e) ? e.status : -1;
		}
		expect(status).toBe(403);
		expect((await act(editActions.publish, other, id)).status).toBe(403);
		expect((await act(editActions.reload, other, id)).status).toBe(403);
		expect((await editDrafts(id)).map((row) => row.createdBy)).toEqual([admin.id]);
	});
});

describe('publishing an edit', () => {
	test('updates the settings and the questions, moves the version on and drops the draft', async () => {
		const { creator, id, questions } = await setup();
		const deadline = new Date(Date.now() + 2 * 86_400_000);

		const outcome = await edit(creator, id, (state) => {
			state.title = '改訂版';
			state.description = '説明を追加';
			state.visibility = 'admin_only';
			state.allowEdit = false;
			state.announceClose = false;
			state.deadline = toJstLocal(deadline);
			state.closesAt = '';
			const [name, join, memo] = state.questions;
			state.questions = [
				{ ...join, label: '参加しますか', options: [...join.options, { id: 'maybe', label: '未定' }] },
				{ ...name, helpText: 'フルネームで' },
				memo,
				{
					sourceId: null,
					type: 'date',
					label: '到着日',
					helpText: '',
					required: false,
					options: [],
					allowOther: false
				}
			];
		});

		expect(outcome).toEqual(published(id));
		const row = (await loadForm(id))!;
		expect(row).toMatchObject({
			title: '改訂版',
			description: '説明を追加',
			visibility: 'admin_only',
			allowEdit: false,
			announceClose: false,
			closesAt: null,
			version: 2
		});
		expect(row.deadline?.getTime()).toBe(Math.floor(deadline.getTime() / 60_000) * 60_000);

		const live = await loadQuestions(id);
		expect(live.map((q) => [q.id, q.position, q.label])).toEqual([
			[questions[1].id, 0, '参加しますか'],
			[questions[0].id, 1, '名前'],
			[questions[2].id, 2, 'メモ'],
			[expect.any(Number), 3, '到着日']
		]);
		expect(live[0].options).toEqual([
			{ id: 'yes', label: '出席' },
			{ id: 'no', label: '欠席' },
			{ id: 'maybe', label: '未定' }
		]);
		expect(live[1].helpText).toBe('フルネームで');
		expect(await editDrafts(id)).toEqual([]);
	});

	test('a removed question is only marked deleted, and a removed option stays marked in the list', async () => {
		const { creator, id, questions } = await setup();

		const outcome = await edit(creator, id, (state) => {
			const [, join, memo] = state.questions;
			state.questions = [{ ...join, options: join.options.filter((o) => o.id !== 'no') }, memo];
		});

		expect(outcome).toEqual(published(id));
		const rows = await allQuestions(id);
		expect(rows.map((q) => [q.id, q.deletedAt !== null])).toEqual([
			[questions[0].id, true],
			[questions[1].id, false],
			[questions[2].id, false]
		]);
		expect(rows[1].options).toEqual([
			{ id: 'yes', label: '出席' },
			{ id: 'no', label: '欠席', deleted: true }
		]);
		expect((await loadQuestions(id)).map((q) => q.id)).toEqual([questions[1].id, questions[2].id]);

		// Listed again, a deleted option comes back.
		expect(
			await edit(creator, id, (state) => {
				state.questions[0].options.push({ id: 'no', label: '欠席します' });
			})
		).toEqual(published(id));
		const [, join] = await allQuestions(id);
		expect(join.options).toEqual([
			{ id: 'yes', label: '出席' },
			{ id: 'no', label: '欠席します' }
		]);
	});

	test('an option deleted after it was answered keeps its label in the results, the CSV and the copy', async () => {
		const { creator, answerer, other, id, questions } = await setup();
		await submit(id, answerer, [TARGET_ROLE], inputs(questions, { 0: '山田', 1: 'no' }));
		await submit(id, other, [TARGET_ROLE], inputs(questions, { 0: '佐藤', 1: 'yes' }));

		expect(
			await edit(creator, id, (state) => {
				state.questions[1].options = state.questions[1].options.filter((o) => o.id !== 'no');
			})
		).toEqual(published(id));

		const results = (await resultsLoad(event(creator, id, `/forms/${id}/results`))) as {
			questions: { id: number; label: string; options: { id: string; label: string }[] | null }[];
			submitted: { displayName: string; updatedAt: Date; submittedAt: Date; answers: Record<number, never> }[];
			outsiders: never[];
			tallies: { questionId: number; options: { id: string; count: number }[] }[];
		};
		const join = results.questions.find((q) => q.id === questions[1].id)!;
		const answered = results.submitted.map((row) => describeAnswer(row.answers[join.id], join.options));
		expect(answered.sort()).toEqual(['出席', '欠席']);
		expect(results.tallies.find((t) => t.questionId === join.id)?.options).toEqual([
			{ id: 'yes', label: '出席', count: 1 }
		]);
		expect(resultTable(results.questions, results.submitted, results.outsiders).rows.flat()).toContain('欠席');

		const text = await (await csv(event(creator, id, `/forms/${id}/results/csv`))).text();
		expect(text).toContain('欠席');

		// No longer offered: choosing it is refused.
		const refused = await settle(submit(id, answerer, [TARGET_ROLE], inputs(questions, { 0: '山田', 1: 'no' })));
		expect(refused.ok ? 'accepted' : (refused.error as Error).message).toBe('選択肢が不正です');
	});

	test('a deleted question leaves the answer page, the results and the CSV', async () => {
		const { creator, answerer, id, questions } = await setup();
		await submit(id, answerer, [TARGET_ROLE], inputs(questions, { 0: '山田', 2: 'メモの内容' }));

		expect(
			await edit(creator, id, (state) => {
				state.questions = state.questions.filter((q) => q.label !== 'メモ');
			})
		).toEqual(published(id));

		const page = await formLoad(event(answerer, id, `/forms/${id}`));
		expect(page.questions.map((q) => q.id)).toEqual([questions[0].id, questions[1].id]);
		expect(Object.keys(page.answers)).toEqual([String(questions[0].id)]);

		const results = (await resultsLoad(event(creator, id, `/forms/${id}/results`))) as {
			questions: { id: number }[];
			submitted: { answers: Record<number, unknown> }[];
		};
		expect(results.questions.map((q) => q.id)).toEqual([questions[0].id, questions[1].id]);
		expect(Object.keys(results.submitted[0].answers)).toEqual([String(questions[0].id)]);

		const text = await (await csv(event(creator, id, `/forms/${id}/results/csv`))).text();
		expect(text).not.toContain('メモ');
		// Kept in the database all the same.
		const [kept] = await db
			.select()
			.from(question)
			.where(and(eq(question.id, questions[2].id), isNotNull(question.deletedAt)));
		expect(kept.label).toBe('メモ');
	});

	test('with responses, the audience, a posted channel and the published types are locked', async () => {
		const { creator, answerer, id, questions } = await setup();
		await submit(id, answerer, [TARGET_ROLE], inputs(questions, { 0: '山田' }));

		expect((await editorOf(creator, id)).locks).toEqual({ audience: true, questionTypes: true, channel: false });
		const refusals = [
			await edit(creator, id, (state) => void (state.targetRoleId = OTHER_ROLE)),
			await edit(creator, id, (state) => void (state.submitScope = 'target_role')),
			await edit(creator, id, (state) => void (state.questions[2].type = 'date'))
		];
		expect(refusals).toEqual([
			{ status: 400, data: { inputError: { message: AUDIENCE_LOCKED, at: { field: 'targetRoleId' } } } },
			{ status: 400, data: { inputError: { message: AUDIENCE_LOCKED, at: { field: 'submitScope' } } } },
			{ status: 400, data: { inputError: { message: TYPE_LOCKED, at: { question: 2 } } } }
		]);
		expect((await loadForm(id))?.version).toBe(1);

		// The channel is free until something is posted to it.
		expect(await edit(creator, id, (state) => void (state.announcementChannelId = CHANNEL_ID))).toEqual(
			published(id)
		);
		expect((await announceForm(id)).ok).toBe(true);
		expect((await editorOf(creator, id)).locks.channel).toBe(true);
		expect(await edit(creator, id, (state) => void (state.announcementChannelId = ''))).toEqual({
			status: 400,
			data: { inputError: { message: CHANNEL_LOCKED, at: { field: 'announcementChannelId' } } }
		});

		// A question added in the edit takes any type.
		expect(
			await edit(creator, id, (state) => {
				state.questions.push({
					sourceId: null,
					type: 'multi',
					label: '日程',
					helpText: '',
					required: false,
					options: [{ id: 'd1', label: '5/2' }],
					allowOther: true
				});
			})
		).toEqual(published(id));
	});

	test('without responses, the audience, the channel and the types may all change', async () => {
		const { creator, id, questions } = await setup();
		discord.calls = [];

		const outcome = await edit(creator, id, (state) => {
			state.targetRoleId = OTHER_ROLE;
			state.submitScope = 'target_role';
			state.announcementChannelId = CHANNEL_ID;
			state.questions[0].type = 'date';
		});

		expect(outcome).toEqual(published(id));
		expect(await loadForm(id)).toMatchObject({
			targetRoleId: OTHER_ROLE,
			submitScope: 'target_role',
			announcementChannelId: CHANNEL_ID
		});
		expect((await loadQuestions(id)).map((q) => [q.id, q.type])[0]).toEqual([questions[0].id, 'date']);
		// The new role's members count at once, as after creating a form.
		expect(discord.count('listMembers')).toBeGreaterThan(0);
	});

	test('an edit started before someone else published is refused, and reloading starts from the form as it is', async () => {
		const { creator, admin, id } = await setup();
		const mine = await editorOf(creator, id);
		const state = structuredClone(mine.draft.state);
		state.title = '作成者の変更';
		const fields = Object.fromEntries([...publishBody(state, 1)].map(([name, value]) => [name, [String(value)]]));
		expect((await updateDraft(mine.draft.id, creator.id, 1, draftPayload(fields, false))).ok).toBe(true);

		expect(await edit(admin, id, (state) => void (state.title = '管理者の変更'))).toEqual(published(id));

		const refused = await act(editActions.publish, creator, id, publishBody(state, mine.baseVersion));
		expect(refused).toEqual({ status: 409, data: { reason: 'stale', message: STALE } });
		expect(await loadForm(id)).toMatchObject({ title: '管理者の変更', version: 2 });

		const reopened = await editorOf(creator, id);
		expect(reopened.stale).toBe(true);
		expect(reopened.draft.id).toBe(mine.draft.id);

		expect(await act(editActions.reload, creator, id)).toEqual({ status: 303, location: `/forms/${id}/edit` });
		const fresh = await editorOf(creator, id);
		expect(fresh.draft.id).not.toBe(mine.draft.id);
		expect(fresh).toMatchObject({ baseVersion: 2, stale: false, resumed: false });
		expect(fresh.draft.state.title).toBe('管理者の変更');
	});

	test('an edit opened but never saved starts again from the form someone else has since published', async () => {
		const { creator, admin, id } = await setup();
		// Opening alone, as a hover preload does, makes a draft at version 1.
		const opened = await editorOf(creator, id);

		expect(await edit(admin, id, (state) => void (state.title = '管理者の変更'))).toEqual(published(id));

		const reopened = await editorOf(creator, id);
		expect(reopened.draft.id).not.toBe(opened.draft.id);
		expect(reopened).toMatchObject({ baseVersion: 2, stale: false, resumed: false });
		expect(reopened.draft.state.title).toBe('管理者の変更');
		expect((await editDrafts(id)).filter((row) => row.createdBy === creator.id)).toHaveLength(1);

		// The tab still showing the old draft cannot save it any more: its row is gone.
		const late = await updateDraft(opened.draft.id, creator.id, 1, draftPayload({ title: ['古い'] }, false));
		expect(late).toEqual({ ok: false, reason: 'conflict' });
	});

	test('a closed form is refused with 409', async () => {
		const { creator, id } = await setup();
		const editor = await editorOf(creator, id);
		await closeForm(id);

		const outcome = await act(editActions.publish, creator, id, publishBody(editor.draft.state, editor.baseVersion));

		expect(outcome).toEqual({ status: 409, data: { message: CLOSED } });
		expect((await loadForm(id))?.version).toBe(1);
	});

	test('a closesAt in the past is refused as in creating; the deadline may move anywhere', async () => {
		const { creator, id } = await setup();
		const past = toJstLocal(new Date(Date.now() - 3_600_000));

		expect(await edit(creator, id, (state) => void (state.closesAt = past))).toEqual({
			status: 400,
			data: {
				inputError: { message: '受付終了は現在より後の日時を指定してください', at: { field: 'closesAt' } }
			}
		});
		expect(await edit(creator, id, (state) => void (state.deadline = past))).toEqual(published(id));
	});

	test('a question of another form cannot be named as a source', async () => {
		const { creator, id } = await setup();
		const elsewhere = await makeForm(creator);

		const outcome = await edit(creator, id, (state) => {
			state.questions[0].sourceId = elsewhere.questions[0].id;
		});

		expect(outcome).toEqual({
			status: 400,
			data: { inputError: { message: '質問データが不正です', at: { question: 0 } } }
		});
		expect((await allQuestions(elsewhere.id)).map((q) => q.label)).toEqual(['名前', '参加']);
	});

	test('a new deadline lets the automatic reminder go again', async () => {
		const { creator, id } = await setup();
		const soon = new Date(Date.now() + 3_600_000);
		await db.update(form).set({ announcementChannelId: CHANNEL_ID, deadline: soon }).where(eq(form.id, id));

		expect((await sendReminder(id, { kind: 'auto', sentBy: null })).ok).toBe(true);
		expect((await sendReminder(id, { kind: 'auto', sentBy: null })).ok).toBe(false);

		const later = new Date(Date.now() + 5 * 3_600_000);
		expect(await edit(creator, id, (state) => void (state.deadline = toJstLocal(later)))).toEqual(published(id));

		const again = await sendReminder(id, { kind: 'auto', sentBy: null });
		expect(again).toMatchObject({ ok: true, continued: false });
	});
});

describe('answering a form while it is edited', () => {
	test('answers checked before an edit was published are refused, and nothing is written', async () => {
		const { creator, answerer, id, questions } = await setup();
		const editor = await editorOf(creator, id);
		const state = structuredClone(editor.draft.state);
		state.questions[1].label = '参加しますか';

		// The publish holds the form row while its question update sleeps. The submission reads the
		// form and its questions meanwhile, and then waits for the row.
		const { submitted, outcome } = await withSlowWrites(
			{ table: 'question', formId: id, seconds: 0.4 },
			async () => {
				const publishing = act(editActions.publish, creator, id, publishBody(state, editor.baseVersion));
				await sleep(150);
				const submitted = await submit(id, answerer, [TARGET_ROLE], inputs(questions, { 0: '山田', 1: 'yes' }));
				return { submitted, outcome: await publishing };
			}
		);

		expect(outcome).toEqual(published(id));
		expect(submitted).toEqual({ ok: false, reason: 'form_changed' });
		expect(await db.$count(response, eq(response.formId, id))).toBe(0);
		expect(await db.$count(responseRevision)).toBe(0);
	}, 10_000);

	test('the answer page sends the version it drew, and an older one is refused with a message', async () => {
		const { creator, answerer, id } = await setup();
		const page = await formLoad(event(answerer, id, `/forms/${id}`));
		expect(page.form.version).toBe(1);

		expect(await edit(creator, id, (state) => void (state.questions[0].label = '氏名'))).toEqual(published(id));

		const body = new FormData();
		body.set('version', String(page.form.version));
		body.set(`q_${page.questions[0].id}`, '山田');
		const outcome = await act(formActions.default, answerer, id, body, `/forms/${id}`);

		expect(outcome).toEqual({ status: 409, data: { reason: 'form_changed', message: FORM_CHANGED } });
		expect(await db.$count(response, eq(response.formId, id))).toBe(0);

		body.set('version', '2');
		expect(await act(formActions.default, answerer, id, body, `/forms/${id}`)).toEqual({
			status: 200,
			data: { created: true }
		});
	});

	test('a saved answer draft comes back without deleted questions and options', async () => {
		const { creator, answerer, id, questions } = await setup();
		const draft: RevisionAnswers = {
			[questions[0].id]: { type: 'text', text: '山田' },
			[questions[1].id]: { type: 'single', optionId: 'no' },
			[questions[2].id]: { type: 'text', text: 'メモ' },
			999999: { type: 'text', text: '知らない質問' }
		};
		expect((await saveResponseDraft(id, answerer.id, 0, draft)).ok).toBe(true);

		expect(
			await edit(creator, id, (state) => {
				state.questions = state.questions.slice(1);
				state.questions[0].options = state.questions[0].options.filter((o) => o.id !== 'no');
			})
		).toEqual(published(id));

		const page = await formLoad(event(answerer, id, `/forms/${id}`));
		expect(page.draft?.answers).toEqual({ [questions[2].id]: { type: 'text', text: 'メモ' } });
		// The deleted option is sent marked, to name an old answer, and is not offered.
		expect(page.questions[0].options).toEqual([
			{ id: 'yes', label: '出席' },
			{ id: 'no', label: '欠席', deleted: true }
		]);
	});

	test('the histories still show what was answered to a deleted question, marked', async () => {
		const { creator, answerer, id, questions } = await setup();
		await submit(id, answerer, [TARGET_ROLE], inputs(questions, { 0: '山田', 2: '一回目' }));
		const second = await submit(id, answerer, [TARGET_ROLE], inputs(questions, { 0: '山田', 2: '二回目' }));

		expect(
			await edit(creator, id, (state) => void (state.questions = state.questions.slice(0, 2)))
		).toEqual(published(id));

		const page = await formLoad(event(answerer, id, `/forms/${id}`));
		expect(page.deletedQuestions).toEqual([{ id: questions[2].id, label: 'メモ', options: null }]);
		expect(page.history.map((revision) => revision.answers[questions[2].id])).toEqual([
			{ type: 'text', text: '二回目' },
			{ type: 'text', text: '一回目' }
		]);
		expect(page.answers[questions[2].id]).toBeUndefined();

		const responseId = String(second.ok ? second.responseId : -1);
		const history = (await historyLoad({
			locals: sessionLocals(creator),
			params: { id, responseId },
			url: new URL(`${ORIGIN}/forms/${id}/results/${responseId}`)
		} as never)) as Exclude<Awaited<ReturnType<typeof historyLoad>>, void>;
		expect(history.questions.map((q) => [q.label, q.deleted])).toEqual([
			['名前', false],
			['参加', false],
			['メモ', true]
		]);
		expect(history.revisions[0].answers[questions[2].id]).toEqual({ type: 'text', text: '二回目' });
	});
});
