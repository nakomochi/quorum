import { describe, expect, test } from 'bun:test';
import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { draftPayload } from '$lib/form-draft';
import { db } from '$lib/server/db';
import { reminder } from '$lib/server/db/schema';
import { createDraft } from '$lib/server/drafts';
import { closeForm } from '$lib/server/forms';
import { announceForm, sendReminder } from '$lib/server/notify';
import { load as layoutLoad } from '../../src/routes/+layout.server';
import { load as topLoad } from '../../src/routes/+page.server';
import { load as formLoad } from '../../src/routes/forms/[id]/+page.server';
import { load as resultsLoad } from '../../src/routes/forms/[id]/results/+page.server';
import { CHANNEL_ID, discord, GUILD_ID, OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	patchForm,
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
	'payload'
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
		expect(managed.announcement).toEqual({ hasChannel: true, url: url(announcementId) });
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

	test('the creator does see the manager fields', async () => {
		const { creator, adminOnly } = await scene();

		const data = (await resultsLoad(event(creator, { id: adminOnly.id }))) as Record<string, unknown>;

		expect(data.manage).toBe(true);
		expect(data.nonSubmitters).toContain(SECRET_NAME);
		expect(discord.count()).toBe(0);
	});
});
