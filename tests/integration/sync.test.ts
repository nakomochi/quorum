import { describe, expect, test } from 'bun:test';
import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { guildMember, guildSync } from '$lib/server/db/schema';
import { lastSyncedAt, syncAllMembers, syncedGuildRoles } from '$lib/server/guild-sync';
import { discord, OTHER_ROLE, OWNER_ID, TARGET_ROLE, type StubMember } from '../helpers/discord';
import { member, settle, snowflake, withSlowWrites } from '../helpers/fixtures';

async function mirror() {
	return db.select().from(guildMember).orderBy(asc(guildMember.discordId));
}

describe('syncAllMembers', () => {
	test('mirrors every member, with names, roles and bot flags', async () => {
		discord.members = [
			member(snowflake(1), [TARGET_ROLE], { username: 'alice', globalName: 'Alice', nick: 'アリス' }),
			member(snowflake(2), [], { bot: true, username: 'robot' })
		];

		const result = await syncAllMembers();

		expect(result).toMatchObject({ present: 2, markedLeft: 0 });
		const rows = await mirror();
		expect(rows.map((r) => [r.discordId, r.username, r.globalName, r.nickname, r.roleIds, r.isBot, r.leftAt])).toEqual([
			[snowflake(1), 'alice', 'Alice', 'アリス', [TARGET_ROLE], false, null],
			[snowflake(2), 'robot', null, null, [], true, null]
		]);
	});

	test('records a departure once, keeps when it was first seen, and clears it on return', async () => {
		const a = member(snowflake(1));
		const b = member(snowflake(2));
		discord.members = [a, b];
		await syncAllMembers();

		discord.members = [a];
		const first = await syncAllMembers();
		expect(first.markedLeft).toBe(1);
		const leftAt = (await mirror())[1].leftAt;
		expect(leftAt?.getTime()).toBe(first.syncedAt.getTime());

		const second = await syncAllMembers();
		expect(second.markedLeft).toBe(0);
		const [, stillGone] = await mirror();
		expect(stillGone.leftAt?.getTime()).toBe(leftAt!.getTime());
		expect(stillGone.syncedAt.getTime()).toBe(second.syncedAt.getTime());

		discord.members = [a, b];
		await syncAllMembers();
		expect((await mirror())[1].leftAt).toBeNull();
	});

	test('writes the owner and role permissions to guild_sync in the same pass', async () => {
		discord.members = [member(snowflake(1))];
		const result = await syncAllMembers();

		expect((await lastSyncedAt())?.getTime()).toBe(result.syncedAt.getTime());
		const snapshot = await syncedGuildRoles();
		expect(snapshot?.ownerId).toBe(OWNER_ID);
		expect(snapshot?.roles).toEqual(discord.roles.map(({ id, permissions }) => ({ id, permissions })));

		discord.ownerId = snowflake(1);
		discord.roles = discord.roles.slice(0, 2);
		await syncAllMembers();
		expect(await db.select().from(guildSync)).toHaveLength(1);
		expect((await syncedGuildRoles())?.ownerId).toBe(snowflake(1));
		expect((await syncedGuildRoles())?.roles).toHaveLength(2);
	});

	test('an empty member list is refused and changes nothing', async () => {
		discord.members = [member(snowflake(1)), member(snowflake(2))];
		const good = await syncAllMembers();

		discord.members = [];
		await expect(syncAllMembers()).rejects.toThrow('Discord returned no guild members');

		expect((await mirror()).every((row) => row.leftAt === null)).toBe(true);
		expect((await lastSyncedAt())?.getTime()).toBe(good.syncedAt.getTime());
	});

	test('a Discord failure writes nothing', async () => {
		discord.members = [member(snowflake(1))];
		discord.fail('roles', 500);
		await expect(syncAllMembers()).rejects.toThrow();
		expect(await mirror()).toEqual([]);
		expect(await lastSyncedAt()).toBeNull();
	});

	test('concurrent calls in one process share a single sync', async () => {
		discord.members = [member(snowflake(1))];
		const [x, y] = await Promise.all([syncAllMembers(), syncAllMembers()]);
		expect(x).toBe(y);
		expect(discord.count('listMembers')).toBe(1);
	});

	// Regression: two processes whose member lists disagree used to deadlock without the advisory lock.
	test('syncs from separate instances with opposite views do not deadlock', async () => {
		// A and B sort before every common member, so each sync locks its own one first and then
		// needs the other's row to mark it departed.
		const A = snowflake(1);
		const B = snowflake(2);
		const common = Array.from({ length: 20 }, (_, i) => member(snowflake(100 + i)));
		discord.members = [member(A), member(B), ...common];
		await syncAllMembers();

		const views: StubMember[][] = [
			[member(A), ...common],
			[member(B), ...common]
		];
		let listed = 0;
		discord.on('listMembers', (call) => discord.membersPage(views[listed++ % 2], call.url));

		// A second module instance has its own single-flight, as another process would.
		const specifier = '../../src/lib/server/guild-sync.ts?instance=second-process';
		const other = (await import(specifier)) as typeof import('$lib/server/guild-sync');
		expect(other.syncAllMembers).not.toBe(syncAllMembers);

		const finished: number[] = [];
		const results = await withSlowWrites({ table: 'guild_member', seconds: 0.3 }, () =>
			Promise.all(
				[syncAllMembers(), other.syncAllMembers()].map((run, i) =>
					settle(run).then((r) => (finished.push(i), r))
				)
			)
		);

		expect(results.map((r) => (r.ok ? 'ok' : r.code))).toEqual(['ok', 'ok']);
		const values = results.flatMap((r) => (r.ok ? [r.value] : []));
		expect(values.map((v) => v.markedLeft)).toEqual([1, 1]);

		// The mirror is exactly what the later commit saw.
		const later = finished[1];
		const present = new Set(views[later].map((m) => m.id));
		const rows = await mirror();
		expect(rows.filter((r) => present.has(r.discordId) !== (r.leftAt === null))).toEqual([]);
		expect(rows.every((r) => r.syncedAt.getTime() === values[later].syncedAt.getTime())).toBe(true);
		expect((await lastSyncedAt())?.getTime()).toBe(values[later].syncedAt.getTime());
	}, 20_000);

	test('a role change reaches the mirror on the next sync', async () => {
		discord.members = [member(snowflake(1), [TARGET_ROLE])];
		await syncAllMembers();
		discord.members = [member(snowflake(1), [OTHER_ROLE])];
		await syncAllMembers();
		expect((await mirror())[0].roleIds).toEqual([OTHER_ROLE]);
	});
});
