import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { form } from '$lib/server/db/schema';
import {
	closeForm,
	loadForm,
	loadResults,
	countResponses,
	reopenForm,
	RosterRefreshError
} from '$lib/server/forms';
import { syncAllMembers } from '$lib/server/guild-sync';
import { runTick } from '$lib/server/scheduler';
import { discord, OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	patchForm,
	seedGuild,
	snowflake,
	submit
} from '../helpers/fixtures';

async function formRow(id: string) {
	const [row] = await db.select().from(form).where(eq(form.id, id));
	return row;
}

async function counted(id: string) {
	return (await countResponses([id])).get(id);
}

describe('closeForm', () => {
	test('freezes the target roster and the non-submitters', async () => {
		const [creator, a, b, c] = await createUsers([
			snowflake(1),
			snowflake(2),
			snowflake(3),
			snowflake(4)
		]);
		await seedGuild([
			member(creator.discordId, [OTHER_ROLE]),
			member(a.discordId, [TARGET_ROLE], { nick: 'Aさん' }),
			member(b.discordId, [TARGET_ROLE], { nick: 'Bさん' }),
			member(c.discordId, [TARGET_ROLE], { nick: 'Cさん' })
		]);
		const { id, questions } = await makeForm(creator);
		await submit(id, a, [TARGET_ROLE], inputs(questions, { 0: 'x' }));

		expect(await closeForm(id)).toEqual({ ok: true, frozen: 2 });

		const row = await formRow(id);
		expect(row.closedAt).not.toBeNull();
		expect([...row.finalTargetIds!].sort()).toEqual([a.discordId, b.discordId, c.discordId].sort());
		expect(row.finalNonSubmitters).toEqual([
			{ discordId: b.discordId, displayName: 'Bさん' },
			{ discordId: c.discordId, displayName: 'Cさん' }
		]);
	});

	test('refreshes the roster first, and stays open when Discord fails', async () => {
		const [creator] = await createUsers([snowflake(1)]);
		await seedGuild([member(creator.discordId)]);
		const { id } = await makeForm(creator);
		discord.fail('listMembers', 500);

		await expect(closeForm(id)).rejects.toBeInstanceOf(RosterRefreshError);
		expect((await formRow(id)).closedAt).toBeNull();
	});

	test('a second close and an unknown form are refused', async () => {
		const [creator] = await createUsers([snowflake(1)]);
		await seedGuild([member(creator.discordId)]);
		const { id } = await makeForm(creator);
		await closeForm(id);

		expect(await closeForm(id)).toEqual({ ok: false, reason: 'already_closed' });
		expect(await closeForm('missing')).toEqual({ ok: false, reason: 'not_found' });
	});

	test('role changes after the close move nobody in the results or the counts', async () => {
		const [creator, a, b, c, d] = await createUsers([1, 2, 3, 4, 5].map(snowflake));
		await seedGuild([
			member(creator.discordId, [OTHER_ROLE]),
			member(a.discordId),
			member(b.discordId),
			member(c.discordId),
			member(d.discordId, [OTHER_ROLE])
		]);
		const { id, questions } = await makeForm(creator);
		await submit(id, a, [TARGET_ROLE], inputs(questions, { 0: 'x' }));
		await submit(id, d, [OTHER_ROLE], inputs(questions, { 0: 'x' }));
		await closeForm(id);

		const before = await loadResults((await loadForm(id))!);
		const countsBefore = await counted(id);
		expect(before.frozen).toBe(true);
		expect(before.targetCount).toBe(3);
		expect(countsBefore).toEqual({ submitted: 1, targetCount: 3, outsiders: 1 });

		// a and b lose the role, c leaves, d gains it.
		discord.members = [
			member(creator.discordId, [OTHER_ROLE]),
			member(a.discordId, [OTHER_ROLE]),
			member(b.discordId, []),
			member(d.discordId, [TARGET_ROLE])
		];
		await syncAllMembers();

		expect(await loadResults((await loadForm(id))!)).toEqual(before);
		expect(await counted(id)).toEqual(countsBefore);
	});
});

describe('closed_at', () => {
	test('by hand it is the time of the close, even past closes_at', async () => {
		const [creator] = await createUsers([snowflake(1)]);
		await seedGuild([member(creator.discordId)]);
		const plain = await makeForm(creator);
		const passed = await makeForm(creator);
		const closesAt = new Date(Date.now() - 3_600_000);
		await patchForm(passed.id, { closesAt });

		const before = Date.now();
		await closeForm(plain.id);
		await closeForm(passed.id);
		const after = Date.now();

		for (const id of [plain.id, passed.id]) {
			const closedAt = (await formRow(id)).closedAt!.getTime();
			expect(closedAt).toBeGreaterThanOrEqual(before);
			expect(closedAt).toBeLessThanOrEqual(after);
		}
		expect((await formRow(passed.id)).closesAt).toEqual(closesAt);
	});

	test('on schedule it is closes_at, while the roster is frozen as it stands at the close', async () => {
		const [creator, early, late] = await createUsers([1, 2, 3].map(snowflake));
		await seedGuild([member(creator.discordId, [OTHER_ROLE]), member(early.discordId)]);
		const { id } = await makeForm(creator);
		const closesAt = new Date(Date.now() - 3_600_000);
		await patchForm(id, { closesAt });
		// Given the role after closes_at, before the tick got to the form.
		discord.members = [...discord.members, member(late.discordId)];

		expect(await runTick()).toEqual({ reminded: [], closed: [id], closePosted: [], failed: [] });

		const row = await formRow(id);
		expect(row.closedAt).toEqual(closesAt);
		expect([...row.finalTargetIds!].sort()).toEqual([early.discordId, late.discordId].sort());
	});

	test('on schedule, a form whose closes_at is not past or not set stays open', async () => {
		const [creator] = await createUsers([snowflake(1)]);
		await seedGuild([member(creator.discordId)]);
		const unset = await makeForm(creator);
		const future = await makeForm(creator, { closesAt: new Date(Date.now() + 3_600_000) });

		expect(await closeForm(unset.id, 'closes_at')).toEqual({ ok: false, reason: 'not_due' });
		expect(await closeForm(future.id, 'closes_at')).toEqual({ ok: false, reason: 'not_due' });
		expect((await formRow(unset.id)).closedAt).toBeNull();
		expect((await formRow(future.id)).closedAt).toBeNull();
	});
});

describe('reopenForm', () => {
	test('clears the frozen lists and a closes_at that has passed', async () => {
		const [creator] = await createUsers([snowflake(1)]);
		await seedGuild([member(creator.discordId)]);
		const { id } = await makeForm(creator, { closesAt: new Date(Date.now() - 60_000) });
		await closeForm(id);

		expect(await reopenForm(id)).toBe(true);

		const row = await formRow(id);
		expect(row.closedAt).toBeNull();
		expect(row.closesAt).toBeNull();
		expect(row.finalNonSubmitters).toBeNull();
		expect(row.finalTargetIds).toBeNull();
	});

	test('keeps a closes_at still in the future', async () => {
		const [creator] = await createUsers([snowflake(1)]);
		await seedGuild([member(creator.discordId)]);
		const closesAt = new Date(Date.now() + 86_400_000);
		const { id } = await makeForm(creator, { closesAt });
		await closeForm(id);

		expect(await reopenForm(id)).toBe(true);
		expect((await formRow(id)).closesAt?.getTime()).toBe(closesAt.getTime());
	});

	test('an open form is not reopened', async () => {
		const [creator] = await createUsers([snowflake(1)]);
		await seedGuild([member(creator.discordId)]);
		const { id } = await makeForm(creator);
		expect(await reopenForm(id)).toBe(false);
	});
});

describe('loadResults classification', () => {
	test('while open: members, leavers, bots, role-less and unmirrored responders, matching countResponses', async () => {
		const ids = {
			creator: snowflake(1),
			inRoster: snowflake(2),
			leaver: snowflake(3),
			bot: snowflake(4),
			noRole: snowflake(5),
			unmirrored: snowflake(6),
			pending: snowflake(7),
			pendingLeaver: snowflake(8),
			pendingBot: snowflake(9)
		};
		const users = Object.fromEntries(
			(await createUsers(Object.values(ids))).map((u, i) => [Object.keys(ids)[i], u])
		);
		await seedGuild([
			member(ids.creator, [OTHER_ROLE]),
			member(ids.inRoster, [TARGET_ROLE], { nick: '在籍' }),
			member(ids.leaver, [TARGET_ROLE], { nick: '離脱' }),
			member(ids.bot, [TARGET_ROLE], { bot: true, username: 'bot' }),
			member(ids.noRole, [OTHER_ROLE], { globalName: 'ロールなし' }),
			member(ids.pending, [TARGET_ROLE], { nick: '未提出' }),
			member(ids.pendingLeaver, [TARGET_ROLE]),
			member(ids.pendingBot, [TARGET_ROLE], { bot: true })
		]);
		const { id, questions } = await makeForm(users.creator);
		for (const key of ['inRoster', 'leaver', 'bot', 'noRole', 'unmirrored']) {
			const result = await submit(id, users[key], [TARGET_ROLE], inputs(questions, { 0: key }));
			expect(result.ok).toBe(true);
		}
		// The leavers leave after answering.
		discord.members = discord.members.filter(
			(m) => m.id !== ids.leaver && m.id !== ids.pendingLeaver
		);
		await syncAllMembers();

		const results = await loadResults((await loadForm(id))!);

		expect(results.frozen).toBe(false);
		expect(results.submitted.map((r) => r.displayName)).toEqual(['在籍']);
		expect(results.outsiders.map((r) => r.displayName)).toEqual([
			'離脱',
			'bot',
			'ロールなし',
			ids.unmirrored
		]);
		expect(results.nonSubmitters).toEqual(['未提出']);
		expect(results.targetCount).toBe(2);
		expect(await counted(id)).toEqual({ submitted: 1, targetCount: 2, outsiders: 4 });

		// Closing freezes exactly what was shown.
		await closeForm(id);
		const frozen = await loadResults((await loadForm(id))!);
		expect(frozen.submitted.map((r) => r.displayName)).toEqual(['在籍']);
		expect(frozen.nonSubmitters).toEqual(['未提出']);
		expect(await counted(id)).toEqual({ submitted: 1, targetCount: 2, outsiders: 4 });
	});
});
