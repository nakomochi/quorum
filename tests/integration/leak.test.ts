import { describe, expect, test } from 'bun:test';
import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { draftPayload } from '$lib/form-draft';
import { db } from '$lib/server/db';
import { reminder } from '$lib/server/db/schema';
import { createDraft } from '$lib/server/drafts';
import { closeForm } from '$lib/server/forms';
import { syncAllMembers } from '$lib/server/guild-sync';
import { announceForm, sendReminder } from '$lib/server/notify';
import { load as layoutLoad } from '../../src/routes/+layout.server';
import { load as topLoad } from '../../src/routes/+page.server';
import { load as adminLoad } from '../../src/routes/admin/forms/+page.server';
import { load as createdLoad } from '../../src/routes/forms/created/+page.server';
import { load as submittedLoad } from '../../src/routes/forms/submitted/+page.server';
import { actions as formActions, load as formLoad } from '../../src/routes/forms/[id]/+page.server';
import { actions as editActions, load as editLoad } from '../../src/routes/forms/[id]/edit/+page.server';
import {
	actions as resultsActions,
	load as resultsLoad
} from '../../src/routes/forms/[id]/results/+page.server';
import { ADMIN_ROLE, CHANNEL_ID, discord, GUILD_ID, OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
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

const FORBIDDEN_KEYS = [
	'finalNonSubmitters',
	'finalTargetIds',
	'announcementChannelId',
	'announcementMessageId',
	'closeMessageId',
	'channelId',
	'messageId',
	'messageIds',
	'createdBy',
	'targetRoleId',
	'submitScope',
	'discordId',
	'payload',
	'announcedContent'
];

const SECRET_NAME = '秘密の未提出者';

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
	else if (value && typeof value === 'object' && !(value instanceof Date)) {
		for (const [key, item] of Object.entries(value)) {
			into.add(key);
			keysOf(item, into);
		}
	}
	return into;
}

/** Fails naming every forbidden key or string found anywhere in what a load returned. */
function expectNoLeak(data: unknown, secrets: string[]) {
	const keys = keysOf(data);
	expect(FORBIDDEN_KEYS.filter((key) => keys.has(key))).toEqual([]);
	const text = JSON.stringify(data);
	expect(secrets.filter((secret) => text.includes(secret))).toEqual([]);
}

async function scene() {
	const [creator, viewer, other, secretPending] = await createUsers([1, 2, 3, 4].map(snowflake));
	await seedGuild([
		member(creator.discordId, [OTHER_ROLE], { nick: '作成者' }),
		member(viewer.discordId, [TARGET_ROLE], { nick: '閲覧者' }),
		member(other.discordId, [TARGET_ROLE], { nick: '他の人' }),
		member(secretPending.discordId, [TARGET_ROLE], { nick: SECRET_NAME })
	]);

	const open = await makeForm(creator, { announcementChannelId: CHANNEL_ID, submitScope: 'target_role' });
	const adminOnly = await makeForm(creator, { visibility: 'admin_only', announcementChannelId: CHANNEL_ID });
	const afterClose = await makeForm(creator, { visibility: 'after_deadline' });
	for (const f of [open, adminOnly, afterClose]) {
		await submit(f.id, other, [TARGET_ROLE], inputs(f.questions, { 0: 'x' }));
	}
	await closeForm(adminOnly.id);
	await closeForm(afterClose.id);
	discord.calls = [];

	// Everything a member must never receive: other people's snowflakes, ids of the setup, and
	// the frozen non-submitters of a form they may not see.
	const secrets = [
		creator.id,
		creator.discordId,
		other.discordId,
		secretPending.discordId,
		TARGET_ROLE,
		OTHER_ROLE,
		CHANNEL_ID
	];
	return { creator, viewer, other, open, adminOnly, afterClose, secrets };
}

const event = (who: TestUser, params: Record<string, string> = {}, path = '/') =>
	({ locals: sessionLocals(who), params, url: new URL(`http://forms.test${path}`) }) as never;

async function httpStatus(pending: unknown): Promise<number | 'ok'> {
	try {
		await pending;
		return 'ok';
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

describe('what a member receives', () => {
	test('root layout: a name, an icon, two flags and the time, and no Discord call', async () => {
		const { viewer, secrets } = await scene();

		const data = await layoutLoad(event(viewer));

		// toEqual, not toMatchObject: any extra field, such as the email or an id, fails it. The name
		// is the guild nickname, not the account name.
		expect(data).toEqual({
			user: { name: '閲覧者', image: null },
			member: true,
			isAdmin: false,
			now: expect.any(Date)
		});
		expectNoLeak(data, [
			...secrets,
			SECRET_NAME,
			viewer.id,
			viewer.discordId,
			viewer.name,
			`${viewer.discordId}@example.invalid`
		]);
		expect(discord.count()).toBe(0);
	});

	test('root layout: nickname, then display name, then username, and the account name off the roster', async () => {
		const [nicked, globalOnly, bare, outsider] = await createUsers([11, 12, 13, 14].map(snowflake));
		await seedGuild([
			member(nicked.discordId, [TARGET_ROLE], {
				nick: 'ニックネーム',
				globalName: '表示名A',
				username: 'user-a'
			}),
			member(globalOnly.discordId, [TARGET_ROLE], { globalName: '表示名B', username: 'user-b' }),
			member(bare.discordId, [TARGET_ROLE], { username: 'user-c' })
		]);

		const names: unknown[] = [];
		for (const who of [nicked, globalOnly, bare, outsider]) {
			const data = (await layoutLoad(event(who))) as { user: unknown };
			names.push(data.user);
		}

		expect(names).toEqual([
			{ name: 'ニックネーム', image: null },
			{ name: '表示名B', image: null },
			{ name: 'user-c', image: null },
			{ name: outsider.name, image: null }
		]);
		expect(discord.count()).toBe(0);
	});

	test('root layout: the server avatar, then the account avatar, then the login image, then none', async () => {
		const [both, accountOnly, bare, outsider, none] = await createUsers([21, 22, 23, 24, 25].map(snowflake));
		await seedGuild([
			member(both.discordId, [TARGET_ROLE], { avatar: 'account-hash', guildAvatar: 'a_server-hash' }),
			member(accountOnly.discordId, [TARGET_ROLE], { avatar: 'account-hash' }),
			member(bare.discordId, [TARGET_ROLE]),
			member(none.discordId, [TARGET_ROLE])
		]);
		const login = (who: TestUser) => `https://cdn.discordapp.com/avatars/${who.discordId}/login.png`;

		const images: unknown[] = [];
		for (const [who, image] of [
			[both, login(both)],
			[accountOnly, login(accountOnly)],
			[bare, login(bare)],
			[outsider, login(outsider)],
			[none, null]
		] as const) {
			const data = await layoutLoad({ locals: sessionLocals(who, image) } as never);
			expect(keysOf((data as { user: object }).user)).toEqual(new Set(['name', 'image']));
			// The own snowflake may appear inside the URL; nobody else's, and no other id, may.
			const others = [both, accountOnly, bare, outsider, none].filter((u) => u !== who);
			expectNoLeak(data, [
				who.id,
				`${who.discordId}@example.invalid`,
				...others.map((u) => u.discordId)
			]);
			images.push((data as { user: { image: unknown } }).user.image);
		}

		expect(images).toEqual([
			`https://cdn.discordapp.com/guilds/${GUILD_ID}/users/${both.discordId}/avatars/a_server-hash.png?size=64`,
			`https://cdn.discordapp.com/avatars/${accountOnly.discordId}/account-hash.png?size=64`,
			login(bare),
			login(outsider),
			null
		]);
		expect(discord.count()).toBe(0);
	});

	test('top page: summaries only, and no Discord call', async () => {
		const { viewer, open, secrets } = await scene();

		const data = await topLoad(event(viewer));

		expect(data).toMatchObject({ member: true, created: [] });
		expect((data as { pending: { id: string }[] }).pending.map((f) => f.id)).toContain(open.id);
		expectNoLeak(data, [...secrets, SECRET_NAME]);
		expect(discord.count()).toBe(0);
	});

	test('top page: the creator’s forms carry a status, not the times behind it', async () => {
		const { creator, open, adminOnly, secrets } = await scene();
		const ended = await makeForm(creator, { closesAt: new Date(Date.now() + 3_600_000) });
		await patchForm(ended.id, { closesAt: new Date(Date.now() - 60_000) });

		const data = (await topLoad(event(creator))) as { created: { id: string; status: string }[] };

		const byId = new Map(data.created.map((row) => [row.id, row]));
		expect(byId.get(open.id)?.status).toBe('open');
		expect(byId.get(ended.id)?.status).toBe('ended');
		expect(byId.get(adminOnly.id)?.status).toBe('closed');
		expect(keysOf(data.created)).toEqual(
			new Set(['id', 'title', 'deadline', 'responseCount', 'status'])
		);
		expectNoLeak(data, secrets);
		expect(discord.count()).toBe(0);
	});

	test('top page: the newest five of the submitted and created lists, with their totals', async () => {
		const { creator, other, secrets } = await scene();

		const mine = (await topLoad(event(creator))) as Record<string, unknown>;
		const theirs = (await topLoad(event(other))) as Record<string, unknown>;

		expect(Object.keys(mine).sort()).toEqual(
			['created', 'createdTotal', 'drafts', 'member', 'pending', 'submitted', 'submittedTotal'].sort()
		);
		expect([mine.createdTotal, theirs.submittedTotal]).toEqual([3, 3]);
		expect(keysOf(theirs.submitted)).toEqual(new Set(['id', 'title', 'submittedAt', 'revisionCount']));
		expectNoLeak(mine, secrets);
		expectNoLeak(theirs, secrets);
		expect(discord.count()).toBe(0);
	});

	test('list pages: rows, a total and two opaque cursors, and no Discord call', async () => {
		const { creator, other, secrets } = await scene();

		const created = await createdLoad(event(creator, {}, '/forms/created'));
		const submitted = await submittedLoad(event(other, {}, '/forms/submitted'));

		for (const data of [created, submitted]) {
			expect(Object.keys(data).sort()).toEqual(['newer', 'older', 'rows', 'total']);
			expect(data).toMatchObject({ total: 3, older: null, newer: null });
		}
		expect(keysOf(created.rows)).toEqual(new Set(['id', 'title', 'deadline', 'responseCount', 'status']));
		expect(keysOf(submitted.rows)).toEqual(new Set(['id', 'title', 'submittedAt', 'revisionCount']));
		expectNoLeak(created, [...secrets, SECRET_NAME]);
		expectNoLeak(submitted, [...secrets, SECRET_NAME, other.id]);
		expect(discord.count()).toBe(0);
	});

	test('admin list: the drawn columns and counts, never the frozen lists or the role id', async () => {
		const { secrets } = await scene();
		const [admin] = await createUsers([snowflake(9)]);
		discord.members.push(member(admin.discordId, [ADMIN_ROLE]));
		await syncAllMembers();

		const data = (await adminLoad(event(admin, {}, '/admin/forms'))) as { forms: unknown[] };

		expect(Object.keys(data).sort()).toEqual(['forms', 'newer', 'older', 'syncedAt', 'total']);
		expect(data.forms).toHaveLength(3);
		expect(keysOf(data.forms)).toEqual(
			new Set(['id', 'title', 'submitScope', 'deadline', 'closed', 'roleName', 'submitted', 'targetCount', 'outsiders'])
		);
		const keys = keysOf(data);
		expect(FORBIDDEN_KEYS.filter((key) => key !== 'submitScope' && keys.has(key))).toEqual([]);
		const text = JSON.stringify(data);
		expect([...secrets, SECRET_NAME].filter((secret) => text.includes(secret))).toEqual([]);
	});

	test('top page: drafts as id, title and time only, and only the viewer’s own', async () => {
		const { viewer, other, secrets } = await scene();
		const own = await createDraft(
			viewer.id,
			draftPayload(
				{
					title: ['  自分の下書き  '],
					description: ['下書きの本文は一覧に出さない'],
					targetRoleId: [TARGET_ROLE],
					announcementChannelId: [CHANNEL_ID]
				},
				false
			)
		);
		const untitled = await createDraft(viewer.id, draftPayload({ title: [''] }, false));
		await createDraft(other.id, draftPayload({ title: ['他人の下書き'] }, false));

		const data = (await topLoad(event(viewer))) as { drafts: unknown[] };

		expect(data.drafts).toEqual(
			expect.arrayContaining([
				{ id: own.id, title: '自分の下書き', updatedAt: own.updatedAt },
				{ id: untitled.id, title: null, updatedAt: untitled.updatedAt }
			])
		);
		expect(data.drafts).toHaveLength(2);
		expectNoLeak(data, [...secrets, SECRET_NAME, '下書きの本文は一覧に出さない', '他人の下書き']);
		expect(discord.count()).toBe(0);
	});

	test('form page: the questions and the viewer’s own state only', async () => {
		const { viewer, open, secrets } = await scene();

		const data = await formLoad(event(viewer, { id: open.id }, `/forms/${open.id}`));

		expectNoLeak(data, [...secrets, SECRET_NAME, viewer.discordId]);
		expect(discord.count()).toBe(0);
	});

	test('form page: whether the results are hidden from members reaches their managers only', async () => {
		const { creator, viewer, open, adminOnly, afterClose } = await scene();
		const flags = async (who: TestUser, id: string) => {
			const data = await formLoad(event(who, { id }, `/forms/${id}`));
			return { resultsVisible: data.resultsVisible, resultsManagersOnly: data.resultsManagersOnly };
		};

		expect(await flags(creator, adminOnly.id)).toEqual({ resultsVisible: true, resultsManagersOnly: true });
		// Closed, so its results are open to the members as well.
		expect(await flags(creator, afterClose.id)).toEqual({ resultsVisible: true, resultsManagersOnly: false });
		expect(await flags(viewer, adminOnly.id)).toEqual({ resultsVisible: false, resultsManagersOnly: false });
		expect(await flags(viewer, open.id)).toEqual({ resultsVisible: true, resultsManagersOnly: false });
		expect(discord.count()).toBe(0);
	});

	test('results page of a public form: names without ids, no manager fields', async () => {
		const { viewer, open, secrets } = await scene();

		const data = (await resultsLoad(event(viewer, { id: open.id }, `/forms/${open.id}/results`))) as Record<string, unknown>;

		expect(data).toMatchObject({ manage: false, announcement: null, reminders: [], rosterSyncedAt: null });
		expect((data.form as Record<string, unknown>).visibility).toBeNull();
		expect((data.form as Record<string, unknown>).closedAt).toBeNull();
		expect(data.nonSubmitters).toEqual(expect.arrayContaining(['閲覧者', SECRET_NAME]));
		expectNoLeak(data, [...secrets, viewer.discordId]);
		expect(discord.count()).toBe(0);
	});

	test('results page: Discord message links go to managers only, built without asking Discord', async () => {
		const { creator, viewer, open, secrets } = await scene();
		const announced = await announceForm(open.id);
		const reminded = await sendReminder(open.id, { kind: 'manual', sentBy: creator.id });
		expect(announced.ok && reminded.ok).toBe(true);
		const announcementId = announced.ok ? announced.messageId : '';
		const [sent] = await db
			.select({ messageIds: reminder.messageIds })
			.from(reminder)
			.where(eq(reminder.formId, open.id));
		// The row an automatic reminder leaves when nobody is pending: nothing was posted.
		await db.insert(reminder).values({
			formId: open.id,
			kind: 'auto',
			sentBy: null,
			targetDiscordIds: [],
			sentAt: new Date(Date.now() + 60_000)
		});
		discord.calls = [];

		const url = (messageId: string) => `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${messageId}`;
		const path = `/forms/${open.id}/results`;

		const seen = (await resultsLoad(event(viewer, { id: open.id }, path))) as Record<string, unknown>;
		expect(seen).toMatchObject({ manage: false, announcement: null, reminders: [] });
		expectNoLeak(seen, [
			...secrets,
			viewer.discordId,
			announcementId,
			...sent.messageIds,
			'discord.com'
		]);

		const managed = (await resultsLoad(event(creator, { id: open.id }, path))) as {
			announcement: unknown;
			reminders: { url: string | null }[];
		};
		expect(managed.announcement).toEqual({ hasChannel: true, url: url(announcementId), stale: false });
		expect(managed.reminders.map((entry) => entry.url)).toEqual([null, url(sent.messageIds[0])]);
		const keys = keysOf(managed);
		expect(['channelId', 'messageId', 'messageIds'].filter((key) => keys.has(key))).toEqual([]);
		expect(discord.count()).toBe(0);
	});

	test('results page of an admin-only form is refused, with no names in the refusal', async () => {
		const { viewer, adminOnly } = await scene();

		let refusal: unknown;
		try {
			await resultsLoad(event(viewer, { id: adminOnly.id }));
		} catch (e) {
			refusal = e;
		}

		expect(isHttpError(refusal) && refusal.status).toBe(403);
		expect(JSON.stringify(refusal)).not.toContain(SECRET_NAME);
		expect(discord.count()).toBe(0);
	});

	test('after_deadline results open to members once the form is closed', async () => {
		const { viewer, afterClose, secrets } = await scene();

		const data = await resultsLoad(event(viewer, { id: afterClose.id }));

		expect(data).toMatchObject({ manage: false, frozen: true });
		expectNoLeak(data, [...secrets, viewer.discordId]);
	});

	test('after_deadline results stay closed to members while the form is open', async () => {
		const { viewer, creator } = await scene();
		const pending = await makeForm(creator, { visibility: 'after_deadline', deadline: new Date(Date.now() + 86_400_000) });

		expect(await httpStatus(resultsLoad(event(viewer, { id: pending.id })))).toBe(403);
	});

	test('results page actions answer with a sentence and nothing else', async () => {
		const { creator, open, secrets } = await scene();
		const names = ['announce', 'refreshAnnouncement', 'remind', 'syncRoster', 'close', 'reopen'] as const;
		const run = (name: (typeof names)[number]) =>
			resultsActions[name]({ locals: sessionLocals(creator), params: { id: open.id } } as never);

		for (const name of names) {
			if (name === 'refreshAnnouncement') await patchForm(open.id, { title: '改題' });
			const result = await run(name);
			expect(Object.keys(result as object)).toEqual(['notice']);
			expectNoLeak(result, [...secrets, SECRET_NAME]);
		}
		expect(discord.count('edit')).toBe(1);

		await patchForm(open.id, { title: '再改題' });
		discord.fail('edit', 500, 1);
		const { value: failed } = await quietly(async () => run('refreshAnnouncement'));
		expect(Object.keys((failed as { data: object }).data)).toEqual(['message']);
		expectNoLeak((failed as { data: unknown }).data, [...secrets, SECRET_NAME]);
	});

	test('results page: whether the announcement is out of date, never its text', async () => {
		const { creator, viewer, open, secrets } = await scene();
		const announced = await announceForm(open.id);
		const messageId = announced.ok ? announced.messageId : '';
		await patchForm(open.id, { title: '改題' });
		const path = `/forms/${open.id}/results`;

		const managed = (await resultsLoad(event(creator, { id: open.id }, path))) as {
			announcement: unknown;
		};
		expect(managed.announcement).toEqual({
			hasChannel: true,
			url: expect.stringContaining(messageId),
			stale: true
		});
		// The recorded text opens with the old title in bold.
		expectNoLeak(managed, ['📋', 'テストフォーム']);

		const seen = (await resultsLoad(event(viewer, { id: open.id }, path))) as Record<string, unknown>;
		expect(seen).toMatchObject({
			announcement: null,
			announceEditFailed: false,
			deadlineNoticeFailed: false
		});
	});

	test('an input error on the answer page names the question by the id the page already has', async () => {
		const { viewer, open, secrets } = await scene();
		// The first question is required and left blank.
		const request = new Request(`http://forms.test/forms/${open.id}`, {
			method: 'POST',
			body: new FormData()
		});

		const result = (await formActions.default({
			locals: sessionLocals(viewer),
			params: { id: open.id },
			request
		} as never)) as { status: number; data: unknown };

		expect(result.status).toBe(400);
		expect(result.data).toEqual({
			inputError: { message: 'この質問は必須です', at: { questionId: open.questions[0].id } }
		});
		expectNoLeak(result.data, [...secrets, SECRET_NAME, viewer.discordId]);
	});

	test('edit page: the editor and its settings, and nothing else of the form', async () => {
		const { creator, other, open } = await scene();
		const announced = await announceForm(open.id);
		const messageId = announced.ok ? announced.messageId : '';
		discord.calls = [];

		const data = (await editLoad(event(creator, { id: open.id }, `/forms/${open.id}/edit`))) as {
			editor: Record<string, unknown> & { draft: Record<string, unknown> };
		};

		expect(Object.keys(data).sort()).toEqual([
			'closed',
			'editor',
			'form',
			'reopenClearsClosesAt',
			'reopened'
		]);
		expect(Object.keys(data.editor).sort()).toEqual(
			['baseVersion', 'channels', 'deadlineReply', 'draft', 'locks', 'resumed', 'roles', 'stale'].sort()
		);
		// Announced without a deadline: the published deadline as the editor writes it, nothing else.
		expect(data.editor.deadlineReply).toEqual({ from: '' });
		expect(Object.keys(data.editor.draft).sort()).toEqual(['id', 'state', 'updatedAt', 'version']);
		// The settings the editor draws are the manager's to see; nobody's answers or ids are.
		const keys = keysOf(data);
		expect(
			['payload', 'createdBy', 'finalNonSubmitters', 'finalTargetIds', 'announcementMessageId', 'closeMessageId', 'discordId'].filter((key) => keys.has(key))
		).toEqual([]);
		const text = JSON.stringify(data);
		expect([creator.id, other.id, other.discordId, SECRET_NAME, messageId].filter((s) => text.includes(s))).toEqual([]);
		// Roles and channels for the pickers: the only Discord calls.
		expect(new Set(discord.calls.map((call) => call.route))).toEqual(new Set(['roles', 'channels']));
	});

	test('edit page: a closed form gives its title and what reopening it would do, and nothing more', async () => {
		const { creator, adminOnly } = await scene();

		const data = await editLoad(event(creator, { id: adminOnly.id }, `/forms/${adminOnly.id}/edit`));

		expect(data).toEqual({
			form: { id: adminOnly.id, title: 'テストフォーム' },
			closed: true,
			reopenClearsClosesAt: false,
			roster: true,
			reopened: false,
			editor: null
		});
	});

	test('edit page actions answer with a sentence, a reason or an input error, and nothing else', async () => {
		const { creator, open, adminOnly, secrets } = await scene();
		const publish = async (id: string, fields: Record<string, string>) => {
			const body = new FormData();
			for (const [name, value] of Object.entries(fields)) body.set(name, value);
			const request = new Request(`http://forms.test/forms/${id}/edit?/publish`, { method: 'POST', body });
			return (await editActions.publish({
				locals: sessionLocals(creator),
				params: { id },
				request
			} as never)) as { status: number; data: Record<string, unknown> };
		};
		const valid = {
			title: 't',
			targetRoleId: TARGET_ROLE,
			submitScope: 'target_role',
			announcementChannelId: CHANNEL_ID,
			questions: JSON.stringify([{ type: 'text', label: 'q' }])
		};

		// Refused, since the form is open: a success only redirects.
		const reopen = (await editActions.reopen({
			locals: sessionLocals(creator),
			params: { id: open.id }
		} as never)) as { status: number; data: Record<string, unknown> };

		const results = [
			await publish(open.id, { ...valid, title: '' }),
			await publish(open.id, { ...valid, baseVersion: '0' }),
			await publish(adminOnly.id, { ...valid, baseVersion: '1' }),
			reopen
		];

		expect(results.map((r) => [r.status, Object.keys(r.data).sort()])).toEqual([
			[400, ['inputError']],
			[409, ['message', 'reason']],
			[409, ['message']],
			[409, ['message']]
		]);
		for (const result of results) expectNoLeak(result.data, [...secrets, SECRET_NAME]);
	});

	test('a form without a role: no roster fields filled, and its お知らせ give a link and a flag only', async () => {
		const { creator, viewer, other, secrets } = await scene();
		const open = await makeForm(creator, { targetRoleId: null, announcementChannelId: CHANNEL_ID });
		await submit(open.id, other, [TARGET_ROLE], inputs(open.questions, { 0: 'x' }));
		const announced = await announceForm(open.id);
		const remind = (await resultsActions.remind({
			locals: sessionLocals(creator),
			params: { id: open.id }
		} as never)) as object;
		expect(remind).toEqual({ notice: 'お知らせを投稿しました。' });
		const [sent] = await db.select({ messageIds: reminder.messageIds }).from(reminder).where(eq(reminder.formId, open.id));
		discord.calls = [];
		const path = `/forms/${open.id}/results`;

		const seen = (await resultsLoad(event(viewer, { id: open.id }, path))) as Record<string, unknown>;
		expect(seen).toMatchObject({ targetCount: null, nonSubmitters: [], outsiders: [], reminders: [] });
		expectNoLeak(seen, [...secrets, viewer.discordId, ...sent.messageIds, announced.ok ? announced.messageId : '']);

		const managed = (await resultsLoad(event(creator, { id: open.id }, path))) as {
			reminders: Record<string, unknown>[];
		};
		expect(Object.keys(managed.reminders[0]).sort()).toEqual(
			['id', 'kind', 'messageCount', 'notice', 'pendingCount', 'sentAt', 'targetCount', 'url'].sort()
		);
		expectNoLeak(managed, [...secrets.filter((s) => s !== CHANNEL_ID), SECRET_NAME]);

		const closed = await resultsActions.close({ locals: sessionLocals(creator), params: { id: open.id } } as never);
		expect(closed).toEqual({ notice: '締め切りました。' });
	});

	test('the creator does see the manager fields', async () => {
		const { creator, adminOnly } = await scene();

		const data = (await resultsLoad(event(creator, { id: adminOnly.id }))) as Record<string, unknown>;

		expect(data.manage).toBe(true);
		expect(data.nonSubmitters).toContain(SECRET_NAME);
		expect(discord.count()).toBe(0);
	});
});
