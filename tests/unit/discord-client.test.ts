import { describe, expect, test } from 'bun:test';
import {
	DiscordApiError,
	editMessage,
	getGuild,
	getGuildMember,
	listGuildMembers
} from '$lib/server/discord';
import { CHANNEL_ID, discord, OWNER_ID, status } from '../helpers/discord';
import { member, snowflake } from '../helpers/fixtures';

describe('Discord REST client (against the stub)', () => {
	test('retries a 429 and then succeeds', async () => {
		discord.fail('guild', 429, 2);
		expect((await getGuild()).owner_id).toBe(OWNER_ID);
		expect(discord.count('guild')).toBe(3);
	});

	test('gives up after repeated 429s', async () => {
		discord.fail('guild', 429);
		await expect(getGuild()).rejects.toThrow('rate limit not cleared');
		expect(discord.count('guild')).toBe(6);
	});

	test('a 500 is an error, a 404 member is null', async () => {
		discord.fail('getMember', 500, 1);
		await expect(getGuildMember(snowflake(1))).rejects.toBeInstanceOf(DiscordApiError);
		expect(await getGuildMember(snowflake(1))).toBeNull();
	});

	test('a 403 on the member list names the missing intent', async () => {
		discord.on('listMembers', () => status(403, { message: 'Missing Access' }));
		await expect(listGuildMembers()).rejects.toThrow('SERVER MEMBERS INTENT');
	});

	test('pages through more than one page of members', async () => {
		discord.members = Array.from({ length: 1001 }, (_, i) => member(snowflake(i + 1)));
		const members = await listGuildMembers();
		expect(members).toHaveLength(1001);
		expect(discord.count('listMembers')).toBe(2);
	});

	test('editing a message PATCHes it with the body given; a 404 is an error', async () => {
		const edited = await editMessage(CHANNEL_ID, '900000000000000001', {
			content: '本文',
			allowed_mentions: { parse: [] }
		});
		expect(edited).toEqual({ id: '900000000000000001', channel_id: CHANNEL_ID });
		const [call] = discord.edits();
		expect([call.method, call.url.pathname]).toEqual([
			'PATCH',
			`/api/v10/channels/${CHANNEL_ID}/messages/900000000000000001`
		]);
		expect(call.body).toEqual({ content: '本文', allowed_mentions: { parse: [] } });

		discord.fail('edit', 404, 1);
		await expect(
			editMessage(CHANNEL_ID, '900000000000000001', {
				content: 'x',
				allowed_mentions: { parse: [] }
			})
		).rejects.toBeInstanceOf(DiscordApiError);
	});

	test('the stub refuses anything that is not Discord', async () => {
		await expect(fetch('https://example.com/')).rejects.toThrow('unexpected fetch');
	});
});
