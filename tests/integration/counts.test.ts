import { describe, expect, test } from 'bun:test';
import {
	closeForm,
	countResponses,
	loadForm,
	loadQuestions,
	loadResults
} from '$lib/server/forms';
import { syncAllMembers } from '$lib/server/guild-sync';
import { discord, OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	patchForm,
	seedGuild,
	snowflake,
	submit,
	type TestUser
} from '../helpers/fixtures';

const GONE_ROLE = '200000000000000099';

/**
 * Every case the counts branch on: with and without a role, open, ended and closed, frozen lists
 * present or missing, and responders in and out of the roster in each way one can be.
 */
async function variedForms() {
	const keys = ['creator', 'a', 'b', 'bot', 'other', 'both', 'leaver', 'unmirrored', 'silent'] as const;
	const list = await createUsers(keys.map((_, i) => snowflake(i + 1)));
	const u = Object.fromEntries(keys.map((key, i) => [key, list[i]])) as Record<(typeof keys)[number], TestUser>;
	await seedGuild([
		member(u.creator.discordId, [OTHER_ROLE]),
		member(u.a.discordId, [TARGET_ROLE]),
		member(u.b.discordId, [TARGET_ROLE]),
		member(u.bot.discordId, [TARGET_ROLE], { bot: true }),
		member(u.other.discordId, [OTHER_ROLE]),
		member(u.both.discordId, [TARGET_ROLE, OTHER_ROLE]),
		member(u.leaver.discordId, [TARGET_ROLE]),
		member(u.silent.discordId, [TARGET_ROLE])
	]);

	const answer = async (id: string, who: TestUser[]) => {
		const qs = await loadQuestions(id);
		for (const person of who) {
			const result = await submit(id, person, [TARGET_ROLE, OTHER_ROLE], inputs(qs, { 0: 'x' }));
			expect(result.ok).toBe(true);
		}
	};
	const everyone = [u.a, u.bot, u.other, u.both, u.leaver, u.unmirrored];

	const ids: Record<string, string> = {};
	const make = async (name: string, overrides: Parameters<typeof makeForm>[1] = {}) => {
		ids[name] = (await makeForm(u.creator, overrides)).id;
		return ids[name];
	};

	await answer(await make('open'), everyone);
	await answer(await make('openTargetScope', { submitScope: 'target_role' }), [u.a, u.both]);
	await make('empty');
	await answer(await make('otherRole', { targetRoleId: OTHER_ROLE }), everyone);
	await answer(await make('goneRole', { targetRoleId: GONE_ROLE }), [u.a, u.other]);
	await answer(await make('noRole', { targetRoleId: null }), everyone);
	await answer(await make('noRoleClosed', { targetRoleId: null }), [u.a, u.unmirrored]);
	await answer(await make('closed'), everyone);
	await answer(await make('closedLegacyTargets'), [u.a, u.other, u.b]);
	await answer(await make('closedNoNonSubmitters'), [u.a, u.bot]);
	await answer(await make('closedEmpty'), []);
	await answer(await make('ended', { closesAt: new Date(Date.now() + 3_600_000) }), [u.a, u.other]);

	for (const name of ['noRoleClosed', 'closed', 'closedLegacyTargets', 'closedNoNonSubmitters', 'closedEmpty']) {
		expect((await closeForm(ids[name])).ok).toBe(true);
	}
	// Closed before the frozen lists were recorded: the mirror decides, as for an open form.
	await patchForm(ids.closedLegacyTargets, { finalTargetIds: null });
	await patchForm(ids.closedNoNonSubmitters, { finalNonSubmitters: null });
	await patchForm(ids.ended, { closesAt: new Date(Date.now() - 60_000) });

	// After the closes: the roster moves under the frozen forms, and the leaver leaves.
	discord.members = discord.members
		.filter((m) => m.id !== u.leaver.discordId)
		.map((m) =>
			m.id === u.b.discordId
				? { ...m, roles: [OTHER_ROLE] }
				: m.id === u.other.discordId
					? { ...m, roles: [OTHER_ROLE, TARGET_ROLE] }
					: m
		);
	await syncAllMembers();

	return ids;
}

describe('countResponses', () => {
	test('gives what the results page counts, form by form', async () => {
		const ids = await variedForms();
		const counts = await countResponses(Object.values(ids));

		expect(counts.size).toBe(Object.keys(ids).length);
		for (const [name, id] of Object.entries(ids)) {
			const results = await loadResults((await loadForm(id))!);
			expect({ name, ...counts.get(id) }).toEqual({
				name,
				submitted: results.submitted.length,
				targetCount: results.targetCount,
				outsiders: results.outsiders.length
			});
		}
	});

	test('each case comes out as worked by hand', async () => {
		const ids = await variedForms();
		const counts = await countResponses(Object.values(ids));
		const of = (submitted: number, targetCount: number | null, outsiders: number) => ({
			submitted,
			targetCount,
			outsiders
		});

		expect(Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, counts.get(id)]))).toEqual({
			// Live roster a, other, both, silent: the bot, the leaver and the unmirrored are outside.
			open: of(3, 4, 3),
			openTargetScope: of(2, 4, 0),
			empty: of(0, 4, 0),
			otherRole: of(2, 4, 4),
			// Nobody holds the role, so nobody is in the roster.
			goneRole: of(0, 0, 2),
			noRole: of(6, null, 0),
			noRoleClosed: of(2, null, 0),
			// Frozen at close: a, b, both, leaver, silent, whatever the roster did afterwards.
			closed: of(3, 5, 3),
			// No frozen targets: other now counts and b no longer does; the frozen 3 non-submitters stay.
			closedLegacyTargets: of(2, 5, 1),
			// Frozen targets, live non-submitters: other, both, silent.
			closedNoNonSubmitters: of(1, 4, 1),
			closedEmpty: of(0, 5, 0),
			ended: of(2, 4, 0)
		});
	});

	test('counts only the forms asked for, and nothing for none', async () => {
		const ids = await variedForms();

		expect([...(await countResponses([ids.open, ids.noRole])).keys()].sort()).toEqual(
			[ids.open, ids.noRole].sort()
		);
		expect((await countResponses([])).size).toBe(0);
	});
});
