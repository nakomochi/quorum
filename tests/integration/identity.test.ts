import { describe, expect, test } from 'bun:test';
import { isHttpError } from '@sveltejs/kit';
import { activeMember } from '$lib/server/forms';
import { canManageForm, confirmMember, gateMember, requireAdmin } from '$lib/server/guards';
import { reconcileMember } from '$lib/server/guild-sync';
import { ADMIN_ROLE, discord, OTHER_ROLE, TARGET_ROLE, type Route } from '../helpers/discord';
import {
	createUser,
	createUsers,
	member,
	quietly,
	seedGuild,
	sessionLocals,
	snowflake
} from '../helpers/fixtures';

const ME = snowflake(1);
const hasTarget = (m: { roleIds: string[] }) => m.roleIds.includes(TARGET_ROLE);

describe('reconcileMember', () => {
	test('agreement with the mirror costs one lookup and no sync', async () => {
		await seedGuild([member(ME, [TARGET_ROLE, OTHER_ROLE])]);
		discord.members = [member(ME, [OTHER_ROLE, TARGET_ROLE])];

		const result = await reconcileMember(ME, await activeMember(ME));

		expect(result.synced).toBe(false);
		expect(result.live?.roles).toEqual([OTHER_ROLE, TARGET_ROLE]);
		expect(discord.count('getMember')).toBe(1);
		expect(discord.count('listMembers')).toBe(0);
	});

	test('absent on both sides agrees too', async () => {
		await seedGuild([member(snowflake(2))]);
		expect(await reconcileMember(ME, null)).toEqual({ live: null, synced: false });
		expect(discord.count('listMembers')).toBe(0);
	});

	test('a role disagreement repairs the mirror with a full sync', async () => {
		await seedGuild([member(ME, [OTHER_ROLE])]);
		discord.members = [member(ME, [TARGET_ROLE])];

		const result = await reconcileMember(ME, await activeMember(ME));

		expect(result.synced).toBe(true);
		expect(discord.count('listMembers')).toBe(1);
		expect((await activeMember(ME))?.roleIds).toEqual([TARGET_ROLE]);
	});

	test('a departure the mirror missed is synced', async () => {
		await seedGuild([member(ME), member(snowflake(2))]);
		discord.members = [member(snowflake(2))];

		const result = await reconcileMember(ME, await activeMember(ME));

		expect(result).toMatchObject({ live: null, synced: true });
		expect(await activeMember(ME)).toBeNull();
	});
});

describe('gateMember (reads)', () => {
	test('a member the mirror admits passes without asking Discord', async () => {
		const me = await createUser(ME);
		await seedGuild([member(ME)]);

		const gated = await gateMember(sessionLocals(me), hasTarget);

		expect(gated?.discordId).toBe(ME);
		expect(discord.count()).toBe(0);
	});

	test('before refusing, Discord is asked once and a newer role lets the member in', async () => {
		const me = await createUser(ME);
		await seedGuild([member(ME, [OTHER_ROLE])]);
		discord.members = [member(ME, [TARGET_ROLE])];
		const locals = sessionLocals(me);

		const gated = await gateMember(locals, hasTarget);

		expect(gated?.roleIds).toEqual([TARGET_ROLE]);
		expect(discord.count('getMember')).toBe(1);

		// Memoized per request.
		await gateMember(locals, hasTarget);
		expect(discord.count('getMember')).toBe(1);
	});

	test('a non-member is refused after one lookup and no sync', async () => {
		const me = await createUser(ME);
		await seedGuild([member(snowflake(2))]);

		expect(await gateMember(sessionLocals(me))).toBeNull();
		expect(discord.count('getMember')).toBe(1);
		expect(discord.count('listMembers')).toBe(0);
	});

	test('a Discord failure leaves the mirror to decide', async () => {
		const me = await createUser(ME);
		await seedGuild([member(ME, [OTHER_ROLE])]);
		discord.fail('getMember', 500);

		const { value, logged } = await quietly(() => gateMember(sessionLocals(me), hasTarget));

		expect(value?.roleIds).toEqual([OTHER_ROLE]);
		expect(logged).toHaveLength(1);
	});

	test('no session, no member', async () => {
		expect(await gateMember({} as App.Locals)).toBeNull();
		expect(discord.count()).toBe(0);
	});
});

describe('confirmMember (writes)', () => {
	test('Discord decides even when the mirror agrees', async () => {
		const me = await createUser(ME);
		await seedGuild([member(ME, [TARGET_ROLE])]);

		expect(await confirmMember(sessionLocals(me))).toEqual({
			status: 'member',
			roleIds: [TARGET_ROLE]
		});
		expect(discord.count('getMember')).toBe(1);
		expect(discord.count('listMembers')).toBe(0);
	});

	test('a role removed in Discord counts at once and the mirror is repaired', async () => {
		const me = await createUser(ME);
		await seedGuild([member(ME, [TARGET_ROLE])]);
		discord.members = [member(ME, [])];

		expect(await confirmMember(sessionLocals(me))).toEqual({ status: 'member', roleIds: [] });
		expect(discord.count('listMembers')).toBe(1);
		expect((await activeMember(ME))?.roleIds).toEqual([]);
	});

	test('someone the mirror still lists but Discord does not is absent', async () => {
		const me = await createUser(ME);
		await seedGuild([member(ME), member(snowflake(2))]);
		discord.members = [member(snowflake(2))];

		expect(await confirmMember(sessionLocals(me))).toEqual({ status: 'absent' });
	});

	test('Discord answers stand even when the repair sync fails', async () => {
		const me = await createUser(ME);
		await seedGuild([member(ME, [OTHER_ROLE])]);
		discord.members = [member(ME, [TARGET_ROLE])];
		discord.fail('listMembers', 500);

		const { value } = await quietly(() => confirmMember(sessionLocals(me)));

		expect(value).toEqual({ status: 'member', roleIds: [TARGET_ROLE] });
	});

	test('an unreachable Discord is unavailable, never a pass', async () => {
		const me = await createUser(ME);
		await seedGuild([member(ME)]);
		discord.fail('getMember', 500);

		const { value } = await quietly(() => confirmMember(sessionLocals(me)));

		expect(value).toEqual({ status: 'unavailable' });
	});
});

/** The HTTP status and message `run` refused with, or null when it did not throw. */
async function refusal(
	run: () => Promise<unknown>
): Promise<{ status: number; message: string } | null> {
	try {
		await run();
		return null;
	} catch (e) {
		if (!isHttpError(e)) throw e;
		return { status: e.status, message: e.body.message };
	}
}

describe('live admin checks', () => {
	/** An admin by the mirror who did not create the form, and the form's creator. */
	async function scene() {
		const [admin, creator] = await createUsers([ME, snowflake(2)]);
		await seedGuild([member(ME, [ADMIN_ROLE]), member(creator.discordId)]);
		return { admin, creator, target: { createdBy: creator.id } };
	}

	test('an admin passes when Discord answers', async () => {
		const { admin, target } = await scene();

		expect(await canManageForm(sessionLocals(admin), target, 'act')).toBe(true);
		expect((await requireAdmin(sessionLocals(admin))).id).toBe(admin.id);
	});

	test('the admin branch answers 503 like the creator branch when Discord fails', async () => {
		const { admin, creator, target } = await scene();
		discord.fail('getMember', 500);

		const { value: asCreator } = await quietly(() =>
			refusal(() => canManageForm(sessionLocals(creator), target, 'act'))
		);
		expect(asCreator?.status).toBe(503);

		const members = discord.members;
		for (const route of ['guild', 'getMember', 'roles'] as Route[]) {
			discord.reset();
			discord.members = members;
			discord.fail(route, 500);
			for (const access of ['view', 'act'] as const) {
				const { value } = await quietly(() =>
					refusal(() => canManageForm(sessionLocals(admin), target, access))
				);
				expect(value).toEqual(asCreator);
			}
		}
	});

	test('requireAdmin answers 503 when Discord fails', async () => {
		const { admin } = await scene();
		discord.fail('guild', 500);

		const { value } = await quietly(() => refusal(() => requireAdmin(sessionLocals(admin))));

		expect(value?.status).toBe(503);
		expect(value?.message).toContain('Discord に接続できない');
	});
});
