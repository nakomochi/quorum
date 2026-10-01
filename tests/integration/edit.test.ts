import { describe, expect, test } from 'bun:test';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { and, eq, isNotNull } from 'drizzle-orm';
import { formatJstWithYear, toJstLocal } from '$lib/datetime';
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
import { announceForm, refreshAnnouncement, sendReminder } from '$lib/server/notify';
import { saveResponseDraft } from '$lib/server/response-drafts';
import { load as topLoad } from '../../src/routes/+page.server';
import { actions as formActions, load as formLoad } from '../../src/routes/forms/[id]/+page.server';
import { actions as editActions, load as editLoad } from '../../src/routes/forms/[id]/edit/+page.server';
import {
	actions as resultsActions,
	load as resultsLoad
} from '../../src/routes/forms/[id]/results/+page.server';
import { load as historyLoad } from '../../src/routes/forms/[id]/results/[responseId]/+page.server';
import { GET as csv } from '../../src/routes/forms/[id]/results/csv/+server';
import { load as newLoad } from '../../src/routes/forms/new/+page.server';
import { ADMIN_ROLE, CHANNEL_ID, discord, OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	patchForm,
	quietly,
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

const STALE = 'ほかの人が先に変更を保存しました。最新の内容を読み込み直してください。';
const CLOSED = 'フォームを閉じているため編集できません。';
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

/**
 * Opens the edit page as `who`, changes what the editor holds, and publishes it, with `extra`
 * fields beside it.
 */
async function edit(
	who: TestUser,
	id: string,
	change: (state: EditorState) => void,
	extra: Record<string, string> = {}
): Promise<Outcome> {
	const editor = await editorOf(who, id);
	const state = structuredClone(editor.draft.state);
	change(state);
	const body = publishBody(state, editor.baseVersion);
	for (const [name, value] of Object.entries(extra)) body.set(name, value);
	return act(editActions.publish, who, id, body);
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

		expect(data).toEqual({
			form: { id, title: 'テストフォーム' },
			closed: true,
			reopenClearsClosesAt: false,
			reopened: false,
			editor: null
		});
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

describe('reopening from the edit page', () => {
	const reopen = (who: TestUser, id: string) =>
		act(editActions.reopen, who, id, new FormData(), `/forms/${id}/edit?/reopen`);

	test('a manager reopens the form and comes back to the editor, told once', async () => {
		const { creator, admin, id } = await setup();
		await closeForm(id);

		expect(await reopen(creator, id)).toEqual({ status: 303, location: `/forms/${id}/edit?reopened=1` });
		expect((await loadForm(id))?.closedAt).toBeNull();

		const data = (await editLoad(event(creator, id, `/forms/${id}/edit?reopened=1`))) as EditData;
		expect(data).toMatchObject({ closed: false, reopened: true });
		expect(data.editor).not.toBeNull();
		expect((await openEdit(creator, id)).reopened).toBe(false);

		// An admin may as well, as on the results page.
		await closeForm(id);
		expect((await reopen(admin, id)).status).toBe(303);
		expect((await loadForm(id))?.closedAt).toBeNull();
	});

	test('a passed closesAt is said beforehand, and cleared by the reopen', async () => {
		const { creator, id } = await setup();
		await patchForm(id, { closesAt: new Date(Date.now() - 60_000) });
		await closeForm(id);

		expect((await openEdit(creator, id)).reopenClearsClosesAt).toBe(true);
		expect((await reopen(creator, id)).status).toBe(303);
		expect((await loadForm(id))?.closesAt).toBeNull();
	});

	test('anyone else is refused and the form stays closed; an open form is refused with 409', async () => {
		const { creator, other, id } = await setup();
		await closeForm(id);

		expect((await reopen(other, id)).status).toBe(403);
		expect((await loadForm(id))?.closedAt).not.toBeNull();

		expect((await reopen(creator, id)).status).toBe(303);
		expect(await reopen(creator, id)).toEqual({
			status: 409,
			data: { message: 'このフォームはまだ確定していません' }
		});
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
		// Marked required as the answer form marks it; a deleted question never is.
		expect(history.questions.map((q) => [q.label, q.required, q.deleted])).toEqual([
			['名前', true, false],
			['参加', false, false],
			['メモ', false, true]
		]);
		expect(history.revisions[0].answers[questions[2].id]).toEqual({ type: 'text', text: '二回目' });
	});
});

/** Puts the form's announcement in the channel and forgets the calls. Returns its message id. */
async function announce(id: string): Promise<string> {
	await db.update(form).set({ announcementChannelId: CHANNEL_ID }).where(eq(form.id, id));
	const result = await announceForm(id);
	if (!result.ok) throw new Error('announcing failed');
	discord.calls = [];
	return result.messageId;
}

async function announcedContent(id: string) {
	return (await loadForm(id))?.announcedContent;
}

type ResultsData = {
	published: boolean;
	announceEditFailed: boolean;
	deadlineNoticeFailed: boolean;
	announcement: { hasChannel: boolean; url: string | null; stale: boolean } | null;
};

async function resultsOf(who: TestUser, id: string, query = ''): Promise<ResultsData> {
	return (await resultsLoad(event(who, id, `/forms/${id}/results${query}`))) as ResultsData;
}

const refresh = (who: TestUser, id: string) =>
	act(resultsActions.refreshAnnouncement, who, id, new FormData(), `/forms/${id}/results`);

const publishedWith = (id: string, flags: string): Outcome => ({
	status: 303,
	location: `/forms/${id}/results?published=1${flags}`
});

const content = (call: { body: unknown }) => (call.body as { content: string }).content;

const REFRESHED = { status: 200, data: { notice: '告知メッセージを更新しました。' } };

describe('keeping the announcement in step with an edit', () => {
	test('a published title, description or deadline is edited into the announcement', async () => {
		const { creator, id } = await setup();
		const messageId = await announce(id);
		expect(await announcedContent(id)).toContain('📋 **テストフォーム**');
		const later = new Date('2027-01-15T09:30:00Z');

		const changes: [(state: EditorState) => void, string][] = [
			[(state) => void (state.title = '改題'), '📋 **改題**'],
			[(state) => void (state.description = '説明を足しました'), '説明を足しました'],
			[(state) => void (state.deadline = toJstLocal(later)), `締切: ${formatJstWithYear(later)}`]
		];
		for (const [change, expected] of changes) {
			discord.calls = [];
			expect(await edit(creator, id, change)).toEqual(published(id));

			const edits = discord.edits();
			expect(edits.map((call) => call.url.pathname)).toEqual([
				`/api/v10/channels/${CHANNEL_ID}/messages/${messageId}`
			]);
			expect(content(edits[0])).toContain(expected);
			expect((edits[0].body as { allowed_mentions: unknown }).allowed_mentions).toEqual({ parse: [] });
			expect(await announcedContent(id)).toBe(content(edits[0]));
		}
		// Nothing posted for the deadline: the box was not sent.
		expect(discord.count('post')).toBe(0);
		expect((await resultsOf(creator, id)).announcement?.stale).toBe(false);
	});

	test('nothing is edited when only what the announcement leaves out changes', async () => {
		const { creator, id } = await setup();
		await announce(id);

		const outcome = await edit(creator, id, (state) => {
			state.questions[0].label = '氏名';
			state.visibility = 'admin_only';
			state.allowEdit = false;
		});

		expect(outcome).toEqual(published(id));
		expect(discord.count('edit')).toBe(0);
	});

	test('nothing is edited without an announcement', async () => {
		const { creator, id } = await setup();
		await db.update(form).set({ announcementChannelId: CHANNEL_ID }).where(eq(form.id, id));

		expect(await edit(creator, id, (state) => void (state.title = '改題'))).toEqual(published(id));
		expect(discord.count('edit')).toBe(0);
		expect(await refreshAnnouncement(id)).toEqual({ ok: true, edited: false });
	});

	test('an announcement whose text was never recorded is not shown stale, and the next refresh edits and records it', async () => {
		const { creator, id } = await setup();
		const messageId = await announce(id);
		await patchForm(id, { announcedContent: null });
		await patchForm(id, { title: '改題' });
		expect((await resultsOf(creator, id)).announcement).toEqual({
			hasChannel: true,
			url: expect.any(String),
			stale: false
		});

		// The first publish edits it once, whatever changed, and records what it now says.
		expect(await edit(creator, id, (state) => void (state.title = '再改題'))).toEqual(published(id));
		const edits = discord.edits();
		expect(edits.map((call) => call.url.pathname)).toEqual([
			`/api/v10/channels/${CHANNEL_ID}/messages/${messageId}`
		]);
		expect(content(edits[0])).toContain('📋 **再改題**');
		expect(await announcedContent(id)).toBe(content(edits[0]));

		// Recorded from then on: a publish that leaves the text alone edits nothing.
		discord.calls = [];
		expect(await edit(creator, id, (state) => void (state.questions[0].label = '氏名'))).toEqual(published(id));
		expect(discord.count('edit')).toBe(0);

		// Unrecorded with nothing changed, the panel's refresh edits it all the same: the same text again.
		await patchForm(id, { announcedContent: null });
		expect(await refresh(creator, id)).toEqual(REFRESHED);
		expect(discord.count('edit')).toBe(1);
		expect(await announcedContent(id)).toBe(content(edits[0]));
	});

	test('a failed edit keeps the publish and says so, and the panel’s button puts it right', async () => {
		const { creator, id } = await setup();
		await announce(id);
		const before = await announcedContent(id);
		discord.fail('edit', 500, 1);

		const { value: outcome } = await quietly(() =>
			edit(creator, id, (state) => void (state.title = '改題'))
		);

		expect(outcome).toEqual(publishedWith(id, '&announce_edit=failed'));
		expect(await loadForm(id)).toMatchObject({ title: '改題', version: 2, announcedContent: before });
		expect(await resultsOf(creator, id, '?published=1&announce_edit=failed')).toMatchObject({
			published: true,
			announceEditFailed: true,
			deadlineNoticeFailed: false,
			announcement: { stale: true }
		});

		discord.calls = [];
		expect(await refresh(creator, id)).toEqual(REFRESHED);
		expect(discord.edits().map(content)[0]).toContain('📋 **改題**');
		expect((await resultsOf(creator, id)).announcement?.stale).toBe(false);

		// Up to date: said the same, and nothing is asked of Discord.
		discord.calls = [];
		expect(await refresh(creator, id)).toEqual(REFRESHED);
		expect(discord.count('edit')).toBe(0);

		await patchForm(id, { title: '三度目' });
		discord.fail('edit', 500, 1);
		const { value: failed } = await quietly(() => refresh(creator, id));
		expect(failed).toEqual({
			status: 502,
			data: { message: '告知メッセージを更新できませんでした。時間をおいてもう一度お試しください。' }
		});
		expect((await resultsOf(creator, id)).announcement?.stale).toBe(true);
	});

	test('an edit published while the announcement is edited leaves it stale for the next refresh', async () => {
		const { id } = await setup();
		await announce(id);
		const before = await announcedContent(id);
		await patchForm(id, { title: '改題' });

		let moved = false;
		discord.on('edit', async () => {
			if (!moved) {
				moved = true;
				await patchForm(id, { version: 2, title: 'さらに改題' });
			}
			return undefined;
		});

		expect(await refreshAnnouncement(id)).toEqual({ ok: true, edited: true });
		expect(await announcedContent(id)).toBe(before);

		expect(await refreshAnnouncement(id)).toEqual({ ok: true, edited: true });
		const last = discord.edits().at(-1);
		expect(last && content(last)).toContain('📋 **さらに改題**');
		expect(await announcedContent(id)).toBe(last && content(last));
	});

	test('only the creator and admins may refresh the announcement', async () => {
		const { creator, other, admin, id } = await setup();
		await announce(id);
		await patchForm(id, { title: '改題' });

		expect((await refresh(other, id)).status).toBe(403);
		expect(discord.count('edit')).toBe(0);
		expect(await refresh(admin, id)).toEqual(REFRESHED);
		expect(await refresh(creator, id)).toEqual(REFRESHED);
		expect(discord.count('edit')).toBe(1);
	});
});

describe('telling Discord the deadline changed', () => {
	const later = new Date('2027-01-15T09:30:00Z');
	const evenLater = new Date('2027-02-01T03:00:00Z');

	test('a reply to the announcement mentioning nobody, after the announcement is edited', async () => {
		const { creator, id } = await setup();
		const messageId = await announce(id);
		expect((await editorOf(creator, id)).deadlineReply).toEqual({ from: '' });

		const set = await edit(creator, id, (state) => void (state.deadline = toJstLocal(later)), {
			notifyDeadline: 'on'
		});

		expect(set).toEqual(published(id));
		expect(discord.posts().map((call) => [call.url.pathname, call.body])).toEqual([
			[
				`/api/v10/channels/${CHANNEL_ID}/messages`,
				{
					content: `締切を ${formatJstWithYear(later)} に変更しました。`,
					allowed_mentions: { parse: [] },
					message_reference: { message_id: messageId, fail_if_not_exists: false }
				}
			]
		]);
		expect(
			discord.calls.filter((call) => call.route === 'edit' || call.route === 'post').map((call) => call.route)
		).toEqual(['edit', 'post']);
		expect((await editorOf(creator, id)).deadlineReply).toEqual({ from: toJstLocal(later) });

		discord.calls = [];
		const cleared = await edit(creator, id, (state) => void (state.deadline = ''), { notifyDeadline: 'on' });

		expect(cleared).toEqual(published(id));
		expect(discord.posts().map(content)).toEqual(['締切をなしに変更しました。']);
	});

	test('nothing is posted unless the deadline changed, the box was sent and there is an announcement', async () => {
		const { creator, id } = await setup();
		await db.update(form).set({ announcementChannelId: CHANNEL_ID }).where(eq(form.id, id));
		expect((await editorOf(creator, id)).deadlineReply).toBeNull();

		expect(
			await edit(creator, id, (state) => void (state.deadline = toJstLocal(later)), { notifyDeadline: 'on' })
		).toEqual(published(id));
		expect(discord.count('post')).toBe(0);

		await announce(id);
		const outcomes = [
			// Not asked for.
			await edit(creator, id, (state) => void (state.deadline = toJstLocal(evenLater))),
			// Asked for, with the deadline as it was.
			await edit(creator, id, (state) => void (state.title = '改題'), { notifyDeadline: 'on' }),
			await edit(creator, id, (state) => void (state.deadline = toJstLocal(evenLater)), {
				notifyDeadline: 'on'
			})
		];

		expect(outcomes).toEqual([published(id), published(id), published(id)]);
		expect(discord.count('post')).toBe(0);
		expect((await loadForm(id))?.version).toBe(5);
	});

	test('a failed reply is not retried and leaves the publish standing; both failures are reported together', async () => {
		const { creator, id } = await setup();
		await announce(id);
		discord.fail('post', 500, 1);

		const { value: first } = await quietly(() =>
			edit(creator, id, (state) => void (state.deadline = toJstLocal(later)), { notifyDeadline: 'on' })
		);

		expect(first).toEqual(publishedWith(id, '&deadline_notice=failed'));
		expect(discord.count('post')).toBe(1);
		const row = (await loadForm(id))!;
		expect([row.version, row.deadline?.getTime()]).toEqual([2, later.getTime()]);

		discord.fail('edit', 500, 1);
		discord.fail('post', 500, 1);
		const { value: second } = await quietly(() =>
			edit(creator, id, (state) => void (state.deadline = toJstLocal(evenLater)), { notifyDeadline: 'on' })
		);

		expect(second).toEqual(publishedWith(id, '&announce_edit=failed&deadline_notice=failed'));
		expect((await loadForm(id))?.version).toBe(3);
		expect(
			await resultsOf(creator, id, '?published=1&announce_edit=failed&deadline_notice=failed')
		).toMatchObject({ published: true, announceEditFailed: true, deadlineNoticeFailed: true });
	});
});
