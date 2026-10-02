import { describe, expect, test } from 'bun:test';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { questionsField, type EditorState } from '$lib/form-draft';
import { AUDIENCE_LOCKED, NO_TARGET_ROLE } from '$lib/forms';
import { db } from '$lib/server/db';
import { form, reminder, responseDraft } from '$lib/server/db/schema';
import { listPendingForms, pageSubmittedForms } from '$lib/server/form-lists';
import { closeForm, countResponses, loadForm } from '$lib/server/forms';
import { FIRST_PAGE } from '$lib/server/keyset';
import { listReminders, sendReminder } from '$lib/server/notify';
import { runTick } from '$lib/server/scheduler';
import { load as formLoad } from '../../src/routes/forms/[id]/+page.server';
import { actions as editActions, load as editLoad } from '../../src/routes/forms/[id]/edit/+page.server';
import {
	actions as resultsActions,
	load as resultsLoad
} from '../../src/routes/forms/[id]/results/+page.server';
import { GET as csv } from '../../src/routes/forms/[id]/results/csv/+server';
import { actions as newActions, load as newLoad } from '../../src/routes/forms/new/+page.server';
import { CHANNEL_ID, discord, OTHER_ROLE, TARGET_ROLE, type Call } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	patchForm,
	quietly,
	seedGuild,
	sessionLocals,
	snowflake,
	submit,
	type TestUser
} from '../helpers/fixtures';

const ORIGIN = 'http://forms.test';
const ANNOUNCEMENT_ID = '900000000000000001';

type PostBody = { content: string; allowed_mentions: unknown; message_reference?: unknown };
const bodyOf = (post: Call) => post.body as PostBody;

/** A creator, a member with the target role, one with another role and one with none, all mirrored. */
async function guild() {
	const [creator, holder, other, bare] = await createUsers([1, 2, 3, 4].map(snowflake));
	await seedGuild([
		member(creator.discordId, [OTHER_ROLE], { nick: '作成者' }),
		member(holder.discordId, [TARGET_ROLE], { nick: 'ロールあり' }),
		member(other.discordId, [OTHER_ROLE], { nick: '別ロール' }),
		member(bare.discordId, [], { nick: 'ロールなし' })
	]);
	return { creator, holder, other, bare };
}

const event = (who: TestUser, id: string, path: string) =>
	({ locals: sessionLocals(who), params: { id }, url: new URL(`${ORIGIN}${path}`) }) as never;

type Outcome = { status: number; location?: string; data?: unknown };

async function act(
	run: (event: never) => unknown,
	who: TestUser,
	id: string,
	body: FormData = new FormData(),
	path = `/forms/${id}`
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

const noRoleForm = (creator: TestUser, overrides: Parameters<typeof makeForm>[1] = {}) =>
	makeForm(creator, { targetRoleId: null, ...overrides });

describe('creating a form without a role', () => {
	test('the create action stores null and everyone, asking Discord neither for roles nor for a sync', async () => {
		const { creator } = await guild();
		const body = new FormData();
		for (const [name, value] of Object.entries({
			title: '全員向け',
			targetRoleId: NO_TARGET_ROLE,
			submitScope: 'target_role',
			questions: JSON.stringify([{ type: 'text', label: '名前' }])
		})) {
			body.set(name, value);
		}

		const result = await act(newActions.default, creator, '', body, '/forms/new');

		expect(result).toEqual({ status: 303, location: '/' });
		const [row] = await db.select().from(form);
		expect(row).toMatchObject({ targetRoleId: null, submitScope: 'everyone' });
		// The creator's own live check only: no role list, no full sync.
		expect(discord.calls.map((call) => call.route)).toEqual(['getMember']);
	});

	test('the editor’s pickers: the channels’ category names come with the one channels request', async () => {
		const { creator } = await guild();
		discord.on('channels', () =>
			Response.json([
				{ id: '300000000000000009', name: 'お知らせ', type: 4, position: 0, parent_id: null },
				{ id: CHANNEL_ID, name: 'general', type: 0, position: 1, parent_id: '300000000000000009' },
				{ id: '300000000000000002', name: 'loose', type: 0, position: 2, parent_id: null },
				{ id: '300000000000000003', name: 'voice', type: 2, position: 3, parent_id: '300000000000000009' }
			])
		);

		const data = (await newLoad(event(creator, '', '/forms/new'))) as { channels: unknown };

		expect(data.channels).toEqual([
			{ id: CHANNEL_ID, name: 'general', category: 'お知らせ' },
			{ id: '300000000000000002', name: 'loose', category: null }
		]);
		expect(discord.count('channels')).toBe(1);
	});
});

describe('answering', () => {
	test('any member may open and answer it, with or without roles; a non-member may not', async () => {
		const { creator, holder, other, bare } = await guild();
		const { id, questions } = await noRoleForm(creator, { submitScope: 'target_role' });
		const [stranger] = await createUsers([snowflake(9)]);

		for (const who of [holder, other, bare]) {
			await formLoad(event(who, id, `/forms/${id}`));
			const roles = who === holder ? [TARGET_ROLE] : who === other ? [OTHER_ROLE] : [];
			expect((await submit(id, who, roles, inputs(questions, { 0: 'x' }))).ok).toBe(true);
		}

		let refused: unknown;
		try {
			await formLoad(event(stranger, id, `/forms/${id}`));
		} catch (e) {
			refused = e;
		}
		expect(isHttpError(refused) && refused.status).toBe(403);
	});

	test('the top page lists it as pending for whoever has not answered', async () => {
		const { creator, holder, bare } = await guild();
		const { id, questions } = await noRoleForm(creator);
		await submit(id, holder, [TARGET_ROLE], inputs(questions, { 0: 'x' }));

		const forBare = await listPendingForms({ roleIds: [] }, bare.id);
		const forHolder = await listPendingForms({ roleIds: [TARGET_ROLE] }, holder.id);
		const holderSubmitted = await pageSubmittedForms({ roleIds: [] }, holder.id, FIRST_PAGE, 20);

		expect(forBare.map((row) => row.id)).toEqual([id]);
		expect(forHolder).toEqual([]);
		expect(holderSubmitted.rows.map((row) => row.id)).toEqual([id]);
	});
});

describe('results', () => {
	test('every response counts as submitted, with no denominator, non-submitters or roster', async () => {
		const { creator, holder, other } = await guild();
		const { id, questions } = await noRoleForm(creator);
		await submit(id, holder, [TARGET_ROLE], inputs(questions, { 0: 'あ' }));
		await submit(id, other, [OTHER_ROLE], inputs(questions, { 0: 'い' }));

		const data = (await resultsLoad(event(creator, id, `/forms/${id}/results`))) as Record<string, unknown>;

		expect(data).toMatchObject({
			targetCount: null,
			frozen: false,
			roleDeleted: false,
			rosterSyncedAt: null,
			outsiders: [],
			nonSubmitters: []
		});
		expect((data.submitted as { displayName: string }[]).map((row) => row.displayName)).toEqual([
			'ロールあり',
			'別ロール'
		]);
		const counts = (await countResponses([id])).get(id);
		expect(counts).toEqual({ submitted: 2, targetCount: null, outsiders: 0 });
		expect(discord.count()).toBe(0);
	});

	test('the CSV has no 対象 column', async () => {
		const { creator, holder } = await guild();
		const { id, questions } = await noRoleForm(creator);
		await submit(id, holder, [TARGET_ROLE], inputs(questions, { 0: 'あ' }));

		const response = await csv({ locals: sessionLocals(creator), params: { id } } as never);
		const [header, row] = (await response.text()).replace(/^\u{FEFF}/u, '').trim().split('\r\n');

		expect(header).toBe('回答者,提出日時,最終更新日時,名前,参加');
		expect(row.startsWith('ロールあり,')).toBe(true);
	});
});

describe('closing', () => {
	test('closes without asking Discord, freezing nothing, and still drops the drafts', async () => {
		const { creator, bare } = await guild();
		const { id } = await noRoleForm(creator);
		await db.insert(responseDraft).values({ formId: id, userId: bare.id, answers: {} });

		expect(await closeForm(id)).toEqual({ ok: true, frozen: null });

		const row = (await loadForm(id))!;
		expect(row.closedAt).not.toBeNull();
		expect(row.finalTargetIds).toBeNull();
		expect(row.finalNonSubmitters).toBeNull();
		expect(await db.select().from(responseDraft).where(eq(responseDraft.formId, id))).toEqual([]);
		expect(discord.count()).toBe(0);
		expect(await closeForm(id)).toEqual({ ok: false, reason: 'already_closed' });
	});

	test('a close by hand says so plainly and posts a reply mentioning nobody', async () => {
		const { creator } = await guild();
		const { id } = await noRoleForm(creator, { title: '文化祭', announcementChannelId: CHANNEL_ID });
		await patchForm(id, { announcementMessageId: ANNOUNCEMENT_ID });

		const result = await act(resultsActions.close, creator, id);

		expect(result).toEqual({ status: 200, data: { notice: '締め切りました。' } });
		const posts = discord.posts();
		expect(posts).toHaveLength(1);
		expect(bodyOf(posts[0])).toEqual({
			content: '「文化祭」を締め切りました。',
			allowed_mentions: { parse: [] },
			message_reference: { message_id: ANNOUNCEMENT_ID, fail_if_not_exists: false }
		});
		expect(discord.count('listMembers')).toBe(0);
		expect((await loadForm(id))!.closeMessageId).toEqual(expect.any(String));
	});
});

const soon = () => new Date(Date.now() + 3_600_000);

describe('お知らせ', () => {
	test('by hand: one reply mentioning nobody, no sync, and an お知らせ in the history', async () => {
		const { creator } = await guild();
		const { id } = await noRoleForm(creator, { title: '文化祭', announcementChannelId: CHANNEL_ID });
		await patchForm(id, { announcementMessageId: ANNOUNCEMENT_ID });

		const result = await act(resultsActions.remind, creator, id);

		expect(result).toEqual({ status: 200, data: { notice: 'お知らせを投稿しました。' } });
		const posts = discord.posts();
		expect(posts).toHaveLength(1);
		const body = bodyOf(posts[0]);
		expect(body.content).toBe(
			`📣 **文化祭** の回答を受け付けています。まだの人は回答をお願いします。\n締切: 未設定\n${ORIGIN}/forms/${id}`
		);
		expect(body.allowed_mentions).toEqual({ parse: [] });
		expect(body.message_reference).toEqual({ message_id: ANNOUNCEMENT_ID, fail_if_not_exists: false });
		expect(discord.count('listMembers')).toBe(0);

		const [row] = await db.select().from(reminder).where(eq(reminder.formId, id));
		expect(row).toMatchObject({ kind: 'manual', sentBy: creator.id, targetDiscordIds: [], pendingDiscordIds: [] });
		expect(row.messageIds).toHaveLength(1);
		const [entry] = await listReminders(id, CHANNEL_ID);
		expect(entry).toMatchObject({ notice: true, targetCount: 0, pendingCount: 0, messageCount: 1 });
		expect(entry.url).toContain(row.messageIds[0]);
	});

	test('automatic: once per deadline, by the tick, without a sync', async () => {
		const { creator } = await guild();
		const { id } = await noRoleForm(creator, { announcementChannelId: CHANNEL_ID, deadline: soon() });

		expect((await runTick()).reminded).toEqual([id]);
		expect((await runTick()).reminded).toEqual([]);
		expect(await sendReminder(id, { kind: 'auto', sentBy: null })).toEqual({
			ok: false,
			reason: 'already_sent'
		});

		const posts = discord.posts();
		expect(posts).toHaveLength(1);
		expect(bodyOf(posts[0]).allowed_mentions).toEqual({ parse: [] });
		expect(discord.count('listMembers')).toBe(0);

		// A new deadline is a new slot.
		await patchForm(id, { deadline: new Date(Date.now() + 7_200_000) });
		expect((await runTick()).reminded).toEqual([id]);
		expect(discord.posts()).toHaveLength(2);
	});

	test('a failed post leaves no record, so the next tick posts it', async () => {
		const { creator } = await guild();
		const { id } = await noRoleForm(creator, { announcementChannelId: CHANNEL_ID, deadline: soon() });
		discord.fail('post', 500, 1);

		const { value } = await quietly(() => runTick());

		expect(value.failed).toEqual([id]);
		expect(await db.select().from(reminder).where(eq(reminder.formId, id))).toEqual([]);
		expect((await runTick()).reminded).toEqual([id]);
	});

	test('a send left partway while the form had a role mentions nobody more', async () => {
		const { creator } = await guild();
		const { id } = await noRoleForm(creator, { announcementChannelId: CHANNEL_ID });
		await db.insert(reminder).values({
			formId: id,
			kind: 'manual',
			sentBy: creator.id,
			targetDiscordIds: [snowflake(2)],
			pendingDiscordIds: [snowflake(3)]
		});

		expect(await sendReminder(id, { kind: 'manual', sentBy: creator.id })).toEqual({ ok: true, notice: true });

		const rows = await db.select().from(reminder).where(eq(reminder.formId, id));
		expect(rows.map((row) => row.pendingDiscordIds)).toEqual([[], []]);
		expect(discord.posts().map((post) => bodyOf(post).allowed_mentions)).toEqual([{ parse: [] }]);
	});
});

describe('editing', () => {
	function publishBody(state: EditorState, baseVersion: number): FormData {
		const data = new FormData();
		for (const name of ['title', 'description', 'targetRoleId', 'announcementChannelId', 'submitScope', 'visibility', 'deadline', 'closesAt'] as const) {
			data.set(name, state[name]);
		}
		data.set('announceClose', state.announceClose ? 'on' : 'off');
		data.set('questions', questionsField(state.questions));
		data.set('baseVersion', String(baseVersion));
		return data;
	}

	async function edit(who: TestUser, id: string, change: (state: EditorState) => void) {
		const data = (await editLoad(event(who, id, `/forms/${id}/edit`))) as {
			editor: { draft: { state: EditorState }; baseVersion: number };
		};
		const state = structuredClone(data.editor.draft.state);
		change(state);
		discord.calls = [];
		return act(editActions.publish, who, id, publishBody(state, data.editor.baseVersion), `/forms/${id}/edit`);
	}

	test('the editor holds none as its own choice', async () => {
		const { creator } = await guild();
		const { id } = await noRoleForm(creator);

		const data = (await editLoad(event(creator, id, `/forms/${id}/edit`))) as {
			editor: { draft: { state: EditorState } };
		};

		expect(data.editor.draft.state.targetRoleId).toBe(NO_TARGET_ROLE);
	});

	test('none to a role, while unanswered: checked against Discord and followed by a sync', async () => {
		const { creator } = await guild();
		const { id } = await noRoleForm(creator);

		const result = await edit(creator, id, (state) => void (state.targetRoleId = TARGET_ROLE));

		expect(result.status).toBe(303);
		expect((await loadForm(id))!.targetRoleId).toBe(TARGET_ROLE);
		// Once for the check and once by the sync, which also reads the members.
		expect(discord.count('roles')).toBe(2);
		expect(discord.count('listMembers')).toBeGreaterThan(0);
	});

	test('a role to none, while unanswered: no role check and no sync', async () => {
		const { creator } = await guild();
		const { id } = await makeForm(creator, { submitScope: 'target_role' });

		const result = await edit(creator, id, (state) => void (state.targetRoleId = NO_TARGET_ROLE));

		expect(result.status).toBe(303);
		expect(await loadForm(id)).toMatchObject({ targetRoleId: null, submitScope: 'everyone' });
		expect(discord.calls.map((call) => call.route)).toEqual(['getMember']);
	});

	test('either way is refused once someone has answered', async () => {
		const { creator, bare, holder } = await guild();
		const none = await noRoleForm(creator);
		const role = await makeForm(creator);
		await submit(none.id, bare, [], inputs(none.questions, { 0: 'x' }));
		await submit(role.id, holder, [TARGET_ROLE], inputs(role.questions, { 0: 'x' }));

		const locked = { status: 400, data: { inputError: { message: AUDIENCE_LOCKED, at: { field: 'targetRoleId' } } } };
		expect(await edit(creator, none.id, (state) => void (state.targetRoleId = TARGET_ROLE))).toEqual(locked);
		expect(await edit(creator, role.id, (state) => void (state.targetRoleId = NO_TARGET_ROLE))).toEqual(locked);
		expect((await loadForm(none.id))!.targetRoleId).toBeNull();
		expect((await loadForm(role.id))!.targetRoleId).toBe(TARGET_ROLE);
	});
});
