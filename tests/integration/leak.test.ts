import { describe, expect, test } from 'bun:test';
import { isHttpError } from '@sveltejs/kit';
import { closeForm } from '$lib/server/forms';
import { load as layoutLoad } from '../../src/routes/+layout.server';
import { load as topLoad } from '../../src/routes/+page.server';
import { load as formLoad } from '../../src/routes/forms/[id]/+page.server';
import { load as resultsLoad } from '../../src/routes/forms/[id]/results/+page.server';
import { CHANNEL_ID, discord, OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
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
	'createdBy',
	'targetRoleId',
	'submitScope',
	'discordId'
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
	test('root layout: a name, an icon and two flags, and no Discord call', async () => {
		const { viewer, secrets } = await scene();

		const data = await layoutLoad(event(viewer));

		// toEqual, not toMatchObject: any extra field, such as the email or an id, fails it. The bare
		// snowflake is left out of the string check only because the test user's name embeds it.
		expect(data).toEqual({ user: { name: viewer.name, image: null }, member: true, isAdmin: false });
		expectNoLeak(data, [...secrets, SECRET_NAME, viewer.id, `${viewer.discordId}@example.invalid`]);
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

	test('form page: the questions and the viewer’s own state only', async () => {
		const { viewer, open, secrets } = await scene();

		const data = await formLoad(event(viewer, { id: open.id }, `/forms/${open.id}`));

		expectNoLeak(data, [...secrets, SECRET_NAME, viewer.discordId]);
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
