import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { form } from '$lib/server/db/schema';
import { closeForm, reopenForm } from '$lib/server/forms';
import { postCloseNotice } from '$lib/server/notify';
import { runTick } from '$lib/server/scheduler';
import { actions as resultsActions } from '../../src/routes/forms/[id]/results/+page.server';
import { CHANNEL_ID, discord, OTHER_ROLE, TARGET_ROLE, type Call } from '../helpers/discord';
import {
	createUsers,
	makeForm,
	member,
	patchForm,
	quietly,
	seedGuild,
	sessionLocals,
	settle,
	sleep,
	snowflake,
	type TestUser
} from '../helpers/fixtures';

const ANNOUNCEMENT_ID = '900000000000000001';

const IDLE_TICK = { reminded: [], closed: [], closePosted: [], failed: [] };

type PostBody = {
	content: string;
	allowed_mentions: unknown;
	message_reference?: unknown;
};

const bodyOf = (post: Call) => post.body as PostBody;

/** A creator without the target role and one target member, mirrored. */
async function guild(): Promise<TestUser> {
	const [creator, target] = await createUsers([snowflake(1), snowflake(2)]);
	await seedGuild([member(creator.discordId, [OTHER_ROLE]), member(target.discordId, [TARGET_ROLE])]);
	return creator;
}

/** The results page's close button. */
function closeByHand(who: TestUser, id: string) {
	return resultsActions.close({ locals: sessionLocals(who), params: { id } } as never);
}

async function formRow(id: string) {
	const [row] = await db.select().from(form).where(eq(form.id, id));
	return row;
}

describe('posting a close to Discord', () => {
	test('a close by hand posts once, replying to the announcement and mentioning the target role only', async () => {
		const creator = await guild();
		const { id } = await makeForm(creator, { title: '春合宿', announcementChannelId: CHANNEL_ID });
		await patchForm(id, { announcementMessageId: ANNOUNCEMENT_ID });

		expect(await closeByHand(creator, id)).toEqual({ closed: 1 });

		const posts = discord.posts();
		expect(posts).toHaveLength(1);
		expect(posts[0].url.pathname).toBe(`/api/v10/channels/${CHANNEL_ID}/messages`);
		expect(bodyOf(posts[0])).toEqual({
			content: `<@&${TARGET_ROLE}> 「春合宿」を締め切りました。`,
			allowed_mentions: { parse: [], roles: [TARGET_ROLE], replied_user: false },
			message_reference: { message_id: ANNOUNCEMENT_ID, fail_if_not_exists: false }
		});
		expect((await formRow(id)).closeMessageId).toEqual(expect.any(String));

		// The tick finds nothing left to post.
		expect(await runTick()).toEqual(IDLE_TICK);
		expect(discord.posts()).toHaveLength(1);
	});

	test('a close on schedule is posted by the same tick, as a plain message before any announcement', async () => {
		const creator = await guild();
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		await patchForm(id, { closesAt: new Date(Date.now() - 1000) });

		expect(await runTick()).toEqual({ reminded: [], closed: [id], closePosted: [id], failed: [] });

		const posts = discord.posts();
		expect(posts).toHaveLength(1);
		expect(bodyOf(posts[0]).content).toBe(`<@&${TARGET_ROLE}> 「テストフォーム」を締め切りました。`);
		expect(bodyOf(posts[0])).not.toHaveProperty('message_reference');

		expect(await runTick()).toEqual(IDLE_TICK);
		expect(discord.posts()).toHaveLength(1);
	});

	test('nothing is posted for a form without a channel, or with the setting off', async () => {
		const creator = await guild();
		const silent = await makeForm(creator);
		const optedOut = await makeForm(creator, { announcementChannelId: CHANNEL_ID, announceClose: false });

		expect(await closeByHand(creator, silent.id)).toEqual({ closed: 1 });
		expect(await closeByHand(creator, optedOut.id)).toEqual({ closed: 1 });
		expect(await postCloseNotice(silent.id)).toEqual({ ok: false, reason: 'skipped' });
		expect(await postCloseNotice(optedOut.id)).toEqual({ ok: false, reason: 'skipped' });

		expect(await runTick()).toEqual(IDLE_TICK);
		expect(discord.posts()).toEqual([]);
	});

	test('a failed post leaves the close standing, and a later tick posts it', async () => {
		const creator = await guild();
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		discord.fail('post', 500, 2);

		const { value } = await quietly(() => closeByHand(creator, id));

		expect(value).toEqual({ closed: 1 });
		const closed = await formRow(id);
		expect(closed.closedAt).not.toBeNull();
		expect(closed.closeNoticeClaimedAt).toBeNull();
		expect(closed.closeMessageId).toBeNull();

		// The tick's own attempt fails too, and the one after it goes through.
		expect((await quietly(() => runTick())).value).toEqual({ ...IDLE_TICK, failed: [id] });
		expect(await runTick()).toEqual({ ...IDLE_TICK, closePosted: [id] });
		expect(await runTick()).toEqual(IDLE_TICK);

		expect(discord.posts()).toHaveLength(3);
		expect((await formRow(id)).closeMessageId).toEqual(expect.any(String));
	});

	test('reopening and closing again posts again', async () => {
		const creator = await guild();
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });

		await closeByHand(creator, id);
		expect(await reopenForm(id)).toBe(true);
		const reopened = await formRow(id);
		expect(reopened.closeNoticeClaimedAt).toBeNull();
		expect(reopened.closeMessageId).toBeNull();

		await closeByHand(creator, id);

		const posts = discord.posts();
		expect(posts).toHaveLength(2);
		expect(bodyOf(posts[1])).toEqual(bodyOf(posts[0]));
	});

	test('closes racing each other and the tick post once', async () => {
		const creator = await guild();
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		// Holds each post open so that every racer is inside its own attempt at once.
		discord.on('post', async () => {
			await sleep(100);
			return undefined;
		});

		await Promise.all([
			settle(closeByHand(creator, id)),
			settle(closeByHand(creator, id)),
			settle(closeByHand(creator, id)),
			runTick(),
			sleep(50).then(runTick)
		]);
		await runTick();

		expect(discord.posts()).toHaveLength(1);
	});

	test('senders racing on one close post it once', async () => {
		const creator = await guild();
		const { id } = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		await closeForm(id);

		const results = await Promise.all(Array.from({ length: 5 }, () => postCloseNotice(id)));

		expect(results.filter((r) => r.ok)).toHaveLength(1);
		expect(results.filter((r) => !r.ok && r.reason === 'skipped')).toHaveLength(4);
		expect(discord.posts()).toHaveLength(1);
	});

	test('a claim a crash left behind is not posted again, and an old close is no longer retried', async () => {
		const creator = await guild();
		const crashed = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		const old = await makeForm(creator, { announcementChannelId: CHANNEL_ID });
		await closeForm(crashed.id);
		await closeForm(old.id);
		await patchForm(crashed.id, { closeNoticeClaimedAt: new Date() });
		await patchForm(old.id, { closedAt: new Date(Date.now() - 25 * 3_600_000) });

		expect(await runTick()).toEqual(IDLE_TICK);
		expect(discord.posts()).toEqual([]);
	});
});
