import { describe, expect, test } from 'bun:test';
import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { guildMember, guildSync } from '$lib/server/db/schema';
import { lastSyncedAt, syncAllMembers, syncedGuildRoles } from '$lib/server/guild-sync';
import {
	discord,
	OTHER_ROLE,
	OWNER_ID,
	status,
	TARGET_ROLE,
	type StubMember
} from '../helpers/discord';
import { member, settle, sleep, snowflake, withSlowWrites } from '../helpers/fixtures';

async function mirror() {
	return db.select().from(guildMember).orderBy(asc(guildMember.discordId));
}

/** A second module instance has its own queue, as another process would. */
async function otherProcess() {
	const specifier = '../../src/lib/server/guild-sync.ts?instance=second-process';
	const other = (await import(specifier)) as typeof import('$lib/server/guild-sync');
	expect(other.syncAllMembers).not.toBe(syncAllMembers);
	return other;
}

function gate() {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	return { opened, open };
}

async function untilListed(count: number) {
	while (discord.count('listMembers') < count) await sleep(1);
}

describe('syncAllMembers', () => {
	test('mirrors every member, with names, roles and bot flags', async () => {
		discord.members = [
			member(snowflake(1), [TARGET_ROLE], {
				username: 'alice',
				globalName: 'Alice',
				nick: 'アリス'
			}),
			member(snowflake(2), [], { bot: true, username: 'robot' })
		];

		const result = await syncAllMembers();

		expect(result).toMatchObject({ present: 2, markedLeft: 0 });
		const rows = await mirror();
		expect(
			rows.map((r) => [
				r.discordId,
				r.username,
				r.globalName,
				r.nickname,
				r.roleIds,
				r.isBot,
				r.leftAt
			])
		).toEqual([
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
		expect(snapshot?.roles).toEqual(
			discord.roles.map(({ id, permissions }) => ({ id, permissions }))
		);

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

	test('a call during a sync gets one started after it, shared by every such call', async () => {
		const before = [member(snowflake(1))];
		discord.members = before;
		const gates = [gate(), gate()];
		let listed = 0;
		discord.on('listMembers', async (call) => {
			const index = listed++;
			if (!gates[index]) return undefined;
			await gates[index].opened;
			// The first fetch answers with the list as it stood when it was sent.
			return index === 0 ? discord.membersPage(before, call.url) : undefined;
		});

		const first = syncAllMembers();
		await untilListed(1);

		// A role granted after the sync in flight fetched the list, e.g. what made these calls sync.
		discord.members = [member(snowflake(1), [TARGET_ROLE])];
		const waiting = [syncAllMembers(), syncAllMembers(), syncAllMembers()];
		expect(waiting[1]).toBe(waiting[0]);
		expect(waiting[2]).toBe(waiting[0]);

		gates[0].open();
		const stale = await first;
		await untilListed(2);
		expect(discord.count('listMembers')).toBe(2);

		// The follow-up has started too, so a call now waits for yet another one.
		const next = syncAllMembers();
		expect(next).not.toBe(waiting[0]);

		gates[1].open();
		const fresh = await waiting[0];
		expect(fresh.syncedAt.getTime()).toBeGreaterThan(stale.syncedAt.getTime());
		expect((await mirror())[0].roleIds).toEqual([TARGET_ROLE]);

		await next;
		expect(discord.count('listMembers')).toBe(3);
	});

	test('a failed sync does not fail the calls waiting for the next one', async () => {
		discord.members = [member(snowflake(1))];
		const held = gate();
		let listed = 0;
		discord.on('listMembers', async () => {
			if (++listed > 1) return undefined;
			await held.opened;
			return status(500);
		});

		const first = settle(syncAllMembers());
		const next = syncAllMembers();
		held.open();

		expect((await first).ok).toBe(false);
		expect(await next).toMatchObject({ present: 1, markedLeft: 0 });

		// Nothing is left behind: the next call runs a sync of its own.
		await syncAllMembers();
		expect(discord.count('listMembers')).toBe(3);
	});

	test('a sync that started earlier in another process keeps the mirror of one that started later', async () => {
		const older = [member(snowflake(1)), member(snowflake(2))];
		const newer = [member(snowflake(1)), member(snowflake(3))];
		discord.members = older;
		await syncAllMembers();

		const held = gate();
		let listed = 0;
		discord.on('listMembers', async (call) => {
			if (++listed > 1) return undefined;
			await held.opened;
			return discord.membersPage(older, call.url);
		});
		const other = await otherProcess();

		const late = syncAllMembers();
		await untilListed(2);
		// Past the earlier one's start whatever the clock's resolution.
		await sleep(5);
		discord.members = newer;
		const fresh = await other.syncAllMembers();
		held.open();

		// It commits last but writes nothing, and reports the newer sync.
		expect(await late).toEqual({ present: 2, markedLeft: 0, syncedAt: fresh.syncedAt });
		const rows = await mirror();
		expect(rows.map((r) => [r.discordId, r.leftAt === null])).toEqual([
			[snowflake(1), true],
			[snowflake(2), false],
			[snowflake(3), true]
		]);
		expect(rows.every((r) => r.syncedAt.getTime() === fresh.syncedAt.getTime())).toBe(true);
		expect((await lastSyncedAt())?.getTime()).toBe(fresh.syncedAt.getTime());
	});

	test('the mirror and last_full_sync_at record when the list was fetched, not when it was written', async () => {
		discord.members = [member(snowflake(1))];
		const held = gate();
		discord.on('listMembers', async () => {
			await held.opened;
			return undefined;
		});

		const called = Date.now();
		const run = syncAllMembers();
		await sleep(50);
		held.open();
		const result = await run;

		expect(result.syncedAt.getTime()).toBeLessThan(called + 50);
		expect((await mirror())[0].syncedAt.getTime()).toBe(result.syncedAt.getTime());
		expect((await lastSyncedAt())?.getTime()).toBe(result.syncedAt.getTime());
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
		discord.on('listMembers', async (call) => {
			const view = views[listed++];
			// The later sync reaches its writes while the earlier one is in the middle of its own.
			if (view === views[1]) await sleep(50);
			return discord.membersPage(view, call.url);
		});
		const other = await otherProcess();

		const results = await withSlowWrites({ table: 'guild_member', seconds: 0.3 }, async () => {
			const earlier = settle(syncAllMembers());
			// Started strictly later, so the freshness check lets both write.
			await sleep(5);
			const later = settle(other.syncAllMembers());
			return Promise.all([earlier, later]);
		});

		expect(results.map((r) => (r.ok ? 'ok' : r.code))).toEqual(['ok', 'ok']);
		const values = results.flatMap((r) => (r.ok ? [r.value] : []));
		expect(values.map((v) => v.markedLeft)).toEqual([1, 1]);

		// The mirror is exactly what the later sync saw.
		const present = new Set(views[1].map((m) => m.id));
		const rows = await mirror();
		expect(rows.filter((r) => present.has(r.discordId) !== (r.leftAt === null))).toEqual([]);
		expect(rows.every((r) => r.syncedAt.getTime() === values[1].syncedAt.getTime())).toBe(true);
		expect((await lastSyncedAt())?.getTime()).toBe(values[1].syncedAt.getTime());
	}, 20_000);

	test('keeps the server avatar apart from the account avatar, and follows changes to either', async () => {
		discord.members = [
			member(snowflake(1), [], { avatar: 'account-a', guildAvatar: 'a_server-a' }),
			member(snowflake(2), [], { avatar: 'account-b' }),
			member(snowflake(3))
		];
		await syncAllMembers();
		const hashes = async () => (await mirror()).map((r) => [r.avatarHash, r.guildAvatarHash]);
		expect(await hashes()).toEqual([
			['account-a', 'a_server-a'],
			['account-b', null],
			[null, null]
		]);

		discord.members = [
			member(snowflake(1), [], { avatar: 'account-a' }),
			member(snowflake(2), [], { avatar: 'account-b', guildAvatar: 'server-b' }),
			member(snowflake(3))
		];
		await syncAllMembers();
		expect(await hashes()).toEqual([
			['account-a', null],
			['account-b', 'server-b'],
			[null, null]
		]);
	});

	test('a role change reaches the mirror on the next sync', async () => {
		discord.members = [member(snowflake(1), [TARGET_ROLE])];
		await syncAllMembers();
		discord.members = [member(snowflake(1), [OTHER_ROLE])];
		await syncAllMembers();
		expect((await mirror())[0].roleIds).toEqual([OTHER_ROLE]);
	});
});
