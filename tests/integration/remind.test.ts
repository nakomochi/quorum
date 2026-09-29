import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { reminder } from '$lib/server/db/schema';
import { closeForm } from '$lib/server/forms';
import { announceForm, listReminders, sendReminder } from '$lib/server/notify';
import { runTick } from '$lib/server/scheduler';
import { CHANNEL_ID, discord, OTHER_ROLE, status, TARGET_ROLE, type Call } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	patchForm,
	quietly,
	seedGuild,
	snowflake,
	submit
} from '../helpers/fixtures';

const AUTO = { kind: 'auto', sentBy: null } as const;

async function reminders(formId: string) {
	return db.select().from(reminder).where(eq(reminder.formId, formId));
}

/** A creator without the target role plus `size` target members, all mirrored. */
async function guild(size: number) {
	const ids = Array.from({ length: size + 1 }, (_, i) => snowflake(i + 1));
	const [creator, ...users] = await createUsers(ids);
	await seedGuild([member(creator.discordId, [OTHER_ROLE]), ...users.map((u) => member(u.discordId))]);
	return { creator, users };
}

const soon = () => new Date(Date.now() + 3_600_000);

/** Answers the `n`th post from now with a 500 and lets every other one through. */
function failNthPost(n: number) {
	let seen = 0;
	discord.on('post', () => (++seen === n ? status(500) : undefined));
}

function mentioned(post: Call): string[] {
	return (post.body as { allowed_mentions: { users: string[] } }).allowed_mentions.users;
}

describe('Discord posts', () => {
	test('the announcement and the reminder give the deadline with its year, this year’s too', async () => {
		const { creator } = await guild(1);
		// January 2 of the current JST year: a date the page would show without its year.
		const year = new Date(Date.now() + 9 * 3_600_000).getUTCFullYear();
		const deadline = new Date(`${year}-01-02T10:00:00+09:00`);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID, deadline });

		expect((await announceForm(id)).ok).toBe(true);
		expect((await sendReminder(id, { kind: 'manual', sentBy: creator.id })).ok).toBe(true);

		const contents = discord.posts().map((post) => (post.body as { content: string }).content);
		expect(contents).toHaveLength(2);
		for (const content of contents) expect(content).toContain(`締切: ${year}/01/02 10:00\n`);
	});

	test('a form without a deadline says so', async () => {
		const { creator } = await guild(1);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });

		expect((await announceForm(id)).ok).toBe(true);

		const [post] = discord.posts();
		expect((post.body as { content: string }).content).toContain('締切: 未設定\n');
	});
});

describe('sendReminder', () => {
	test('mentions only the non-submitters, replying to the announcement', async () => {
		const { creator, users } = await guild(3);
		const { id, questions } = await makeForm(creator, { announcementChannelId: CHANNEL_ID, deadline: soon() });
		await patchForm(id, { announcementMessageId: '900000000000000001' });
		await submit(id, users[0], [TARGET_ROLE], inputs(questions, { 0: 'x' }));

		const result = await sendReminder(id, { kind: 'manual', sentBy: creator.id });

		expect(result).toEqual({ ok: true, targets: 2, messages: 1 });
		const [post] = discord.posts();
		const body = post.body as { content: string; allowed_mentions: { users: string[] }; message_reference: { message_id: string } };
		expect(post.url.pathname).toBe(`/api/v10/channels/${CHANNEL_ID}/messages`);
		expect([...body.allowed_mentions.users].sort()).toEqual([users[1].discordId, users[2].discordId].sort());
		expect(body.content).not.toContain(users[0].discordId);
		expect(body.message_reference.message_id).toBe('900000000000000001');

		const [row] = await reminders(id);
		expect(row).toMatchObject({ kind: 'manual', sentBy: creator.id, messageIds: [expect.any(String)] });
		expect([...row.targetDiscordIds].sort()).toEqual([users[1].discordId, users[2].discordId].sort());
	});

	test('splits more than 50 mentions over several messages', async () => {
		const { creator } = await guild(120);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });

		expect(await sendReminder(id, { kind: 'manual', sentBy: creator.id })).toEqual({
			ok: true,
			targets: 120,
			messages: 3
		});
		expect(discord.posts().map((p) => (p.body as { allowed_mentions: { users: string[] } }).allowed_mentions.users.length)).toEqual([50, 50, 20]);
	});

	test('a closed form is refused before anything is asked of Discord', async () => {
		const { creator } = await guild(1);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		await closeForm(id);
		discord.calls = [];

		expect(await sendReminder(id, AUTO)).toEqual({ ok: false, reason: 'closed' });
		expect(discord.count()).toBe(0);

		const timed = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		await patchForm(timed.id, { closesAt: new Date(Date.now() - 1000) });
		expect(await sendReminder(timed.id, AUTO)).toEqual({ ok: false, reason: 'closed' });
		expect(discord.count()).toBe(0);
	});

	test('no channel, unknown form', async () => {
		const { creator } = await guild(1);
		const { id } = await makeForm(creator);
		expect(await sendReminder(id, AUTO)).toEqual({ ok: false, reason: 'no_channel' });
		expect(await sendReminder('missing', AUTO)).toEqual({ ok: false, reason: 'not_found' });
	});

	test('nobody holds the target role: empty_roster', async () => {
		const { creator } = await guild(0);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID, deadline: soon() });

		expect(await sendReminder(id, { kind: 'manual', sentBy: creator.id })).toEqual({ ok: false, reason: 'empty_roster' });
		expect(await reminders(id)).toEqual([]);

		expect(await sendReminder(id, AUTO)).toEqual({ ok: false, reason: 'empty_roster' });
		// The automatic pass records the deadline as handled so it does not come back every tick.
		expect(await reminders(id)).toMatchObject([{ kind: 'auto', targetDiscordIds: [] }]);
		expect(discord.posts()).toEqual([]);
	});

	test('everyone has answered: no_targets', async () => {
		const { creator, users } = await guild(2);
		const { id, questions } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		for (const u of users) await submit(id, u, [TARGET_ROLE], inputs(questions, { 0: 'x' }));

		expect(await sendReminder(id, { kind: 'manual', sentBy: creator.id })).toEqual({ ok: false, reason: 'no_targets' });
		expect(discord.posts()).toEqual([]);
	});

	test('an automatic reminder goes out once per deadline', async () => {
		const { creator } = await guild(1);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID, deadline: soon() });

		expect((await sendReminder(id, AUTO)).ok).toBe(true);
		expect(await sendReminder(id, AUTO)).toEqual({ ok: false, reason: 'already_sent' });
		expect(discord.posts()).toHaveLength(1);

		// Manual ones are not limited.
		expect((await sendReminder(id, { kind: 'manual', sentBy: creator.id })).ok).toBe(true);

		// A moved deadline is a new deadline.
		await patchForm(id, { deadline: new Date(Date.now() + 7_200_000) });
		expect((await sendReminder(id, AUTO)).ok).toBe(true);
		expect(discord.posts()).toHaveLength(3);
	});

	test('a failed post releases the reservation so the next attempt can send', async () => {
		const { creator } = await guild(1);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID, deadline: soon() });
		discord.fail('post', 500, 1);

		const { value } = await quietly(() => sendReminder(id, AUTO));

		expect(value).toEqual({ ok: false, reason: 'post_failed', targets: 0, remaining: 0 });
		expect(await reminders(id)).toEqual([]);
		expect((await sendReminder(id, AUTO)).ok).toBe(true);
		expect(await reminders(id)).toHaveLength(1);
	});

	test('a manual send that fails partway keeps who was mentioned, and the next one sends only the rest', async () => {
		const { creator, users } = await guild(120);
		const { id, questions } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		const manual = { kind: 'manual', sentBy: creator.id } as const;
		failNthPost(2);

		const { value } = await quietly(() => sendReminder(id, manual));

		expect(value).toEqual({ ok: false, reason: 'post_failed', targets: 50, remaining: 70 });
		const first = mentioned(discord.posts()[0]);
		expect(first).toHaveLength(50);
		const [row] = await reminders(id);
		expect(row.messageIds).toHaveLength(1);
		expect([...row.targetDiscordIds].sort()).toEqual([...first].sort());
		expect(row.pendingDiscordIds).toHaveLength(70);
		expect(await listReminders(id, CHANNEL_ID)).toMatchObject([
			{ kind: 'manual', targetCount: 50, pendingCount: 70, messageCount: 1, url: expect.any(String) }
		]);

		// Someone left pending answers in between and drops out of the rest.
		const answered = users.find((u) => !first.includes(u.discordId))!;
		await submit(id, answered, [TARGET_ROLE], inputs(questions, { 0: 'x' }));
		discord.calls = [];

		expect(await sendReminder(id, manual)).toEqual({ ok: true, targets: 69, messages: 2 });
		const rest = discord.posts().flatMap(mentioned);
		expect(rest).toHaveLength(69);
		expect(rest.filter((discordId) => first.includes(discordId))).toEqual([]);
		expect(rest).not.toContain(answered.discordId);

		// One send, finished in two attempts.
		const [done] = await reminders(id);
		expect(await reminders(id)).toHaveLength(1);
		expect(done.targetDiscordIds).toHaveLength(119);
		expect(done.pendingDiscordIds).toEqual([]);
		expect(done.messageIds).toHaveLength(3);

		// Once finished, a manual reminder goes to every non-submitter again.
		discord.calls = [];
		expect(await sendReminder(id, manual)).toEqual({ ok: true, targets: 119, messages: 3 });
		expect(await reminders(id)).toHaveLength(2);
	});

	test('a send whose continuation fails at once keeps its progress', async () => {
		const { creator } = await guild(120);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		const manual = { kind: 'manual', sentBy: creator.id } as const;
		failNthPost(2);
		await quietly(() => sendReminder(id, manual));
		discord.fail('post', 500, 1);

		const { value } = await quietly(() => sendReminder(id, manual));

		expect(value).toEqual({ ok: false, reason: 'post_failed', targets: 0, remaining: 70 });
		const rows = await reminders(id);
		expect(rows).toHaveLength(1);
		const [row] = rows;
		expect(row.targetDiscordIds).toHaveLength(50);
		expect(row.pendingDiscordIds).toHaveLength(70);
	});

	test('a failed roster refresh sends nothing', async () => {
		const { creator } = await guild(1);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		discord.fail('listMembers', 500);

		const { value } = await quietly(() => sendReminder(id, { kind: 'manual', sentBy: creator.id }));

		expect(value).toEqual({ ok: false, reason: 'sync_failed' });
		expect(discord.posts()).toEqual([]);
		expect(await reminders(id)).toEqual([]);
	});
});

describe('runTick', () => {
	test('reminds a form due within 24 hours once, and closes forms past closes_at', async () => {
		const { creator } = await guild(1);
		const due = await makeForm(creator, { announcementChannelId: CHANNEL_ID, deadline: soon() });
		const later = await makeForm(creator, {
			announcementChannelId: CHANNEL_ID,
			deadline: new Date(Date.now() + 3 * 86_400_000)
		});
		const expired = await makeForm(creator, { closesAt: new Date(Date.now() - 1000) });

		const first = await runTick();
		expect(first).toEqual({ reminded: [due.id], closed: [expired.id], closePosted: [], failed: [] });

		const second = await runTick();
		expect(second).toEqual({ reminded: [], closed: [], closePosted: [], failed: [] });
		expect(discord.posts()).toHaveLength(1);
		expect(await reminders(later.id)).toEqual([]);
	});

	test('an automatic send that fails partway is continued by the next tick for the rest only', async () => {
		const { creator } = await guild(120);
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID, deadline: soon() });
		failNthPost(2);

		const { value } = await quietly(() => runTick());

		expect(value).toEqual({ reminded: [], closed: [], closePosted: [], failed: [id] });
		const first = mentioned(discord.posts()[0]);
		expect(first).toHaveLength(50);
		const [row] = await reminders(id);
		expect(row).toMatchObject({ kind: 'auto', messageIds: [expect.any(String)] });
		expect([...row.targetDiscordIds].sort()).toEqual([...first].sort());
		expect(row.pendingDiscordIds).toHaveLength(70);
		discord.calls = [];

		expect(await runTick()).toEqual({ reminded: [id], closed: [], closePosted: [], failed: [] });
		const rest = discord.posts().flatMap(mentioned);
		expect(rest).toHaveLength(70);
		expect(rest.filter((discordId) => first.includes(discordId))).toEqual([]);

		const rows = await reminders(id);
		expect(rows).toHaveLength(1);
		expect(rows[0].targetDiscordIds).toHaveLength(120);
		expect(rows[0].pendingDiscordIds).toEqual([]);
		expect(rows[0].messageIds).toHaveLength(3);

		// Done for this deadline.
		discord.calls = [];
		expect(await runTick()).toEqual({ reminded: [], closed: [], closePosted: [], failed: [] });
		expect(discord.count()).toBe(0);
	});

	test('an automatic send whose rest have all answered is done without a post', async () => {
		const { creator, users } = await guild(60);
		const { id, questions } = await makeForm(creator, { announcementChannelId: CHANNEL_ID, deadline: soon() });
		failNthPost(2);
		await quietly(() => runTick());
		const [row] = await reminders(id);
		for (const u of users.filter((u) => row.pendingDiscordIds.includes(u.discordId))) {
			await submit(id, u, [TARGET_ROLE], inputs(questions, { 0: 'x' }));
		}
		discord.calls = [];

		expect(await runTick()).toEqual({ reminded: [], closed: [], closePosted: [], failed: [] });
		expect(discord.posts()).toEqual([]);
		const [done] = await reminders(id);
		expect(done.targetDiscordIds).toHaveLength(50);
		expect(done.pendingDiscordIds).toEqual([]);

		discord.calls = [];
		expect(await runTick()).toEqual({ reminded: [], closed: [], closePosted: [], failed: [] });
		expect(discord.count()).toBe(0);
	});
});
