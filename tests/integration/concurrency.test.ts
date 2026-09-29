import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { form, response } from '$lib/server/db/schema';
import { closeForm } from '$lib/server/forms';
import { TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	seedGuild,
	settle,
	sleep,
	snowflake,
	submit,
	withSlowWrites
} from '../helpers/fixtures';

async function crowd(size: number) {
	const ids = Array.from({ length: size + 1 }, (_, i) => snowflake(i + 1));
	const [creator, ...users] = await createUsers(ids);
	await seedGuild(ids.map((id) => member(id)));
	return { creator, users };
}

async function responseCount(formId: string) {
	return (await db.select({ id: response.id }).from(response).where(eq(response.formId, formId))).length;
}

describe('concurrent submissions', () => {
	// Regression: writing the form row after FOR SHARE made concurrent first responses deadlock.
	test('20 people answering an unanswered form at once all succeed', async () => {
		const { creator, users } = await crowd(20);
		const { id, questions } = await makeForm(creator);

		// Every submitter holds FOR SHARE on the form row while its insert sleeps, so any later
		// statement that needs the row exclusively meets all the others at once.
		const results = await withSlowWrites({ table: 'response', formId: id, seconds: 0.2 }, () =>
			Promise.all(users.map((u) => settle(submit(id, u, [TARGET_ROLE], inputs(questions, { 0: u.name })))))
		);

		const failures = results.filter((r) => !r.ok);
		expect(failures.map((r) => (r.ok ? '' : r.code))).toEqual([]);
		expect(results.every((r) => r.ok && r.value.ok && r.value.created)).toBe(true);
		expect(await responseCount(id)).toBe(20);
	}, 20_000);

	test('one person sending 20 edits at once ends with a single response', async () => {
		const { creator, users } = await crowd(1);
		const { id, questions } = await makeForm(creator);
		const [who] = users;

		const results = await Promise.all(
			Array.from({ length: 20 }, (_, i) => settle(submit(id, who, [TARGET_ROLE], inputs(questions, { 0: `edit ${i}` }))))
		);

		expect(results.every((r) => r.ok && r.value.ok)).toBe(true);
		expect(results.filter((r) => r.ok && r.value.ok && r.value.created)).toHaveLength(1);
		expect(await responseCount(id)).toBe(1);
		const [{ revisions }] = await db.$client<{ revisions: number }[]>`
			select count(*)::int as revisions from response_revision`;
		expect(revisions).toBe(20);
	}, 20_000);

	test('with editing off, 20 simultaneous sends leave one response and 19 refusals', async () => {
		const { creator, users } = await crowd(1);
		const { id, questions } = await makeForm(creator, { allowEdit: false });
		const [who] = users;

		const results = await Promise.all(
			Array.from({ length: 20 }, (_, i) => settle(submit(id, who, [TARGET_ROLE], inputs(questions, { 0: `try ${i}` }))))
		);

		expect(results.every((r) => r.ok)).toBe(true);
		const values = results.flatMap((r) => (r.ok ? [r.value] : []));
		expect(values.filter((v) => v.ok)).toHaveLength(1);
		expect(values.filter((v) => !v.ok && v.reason === 'already_submitted')).toHaveLength(19);
		expect(await responseCount(id)).toBe(1);
	}, 20_000);
});

describe('submissions racing a close', () => {
	test('nobody ends up both a responder and a frozen non-submitter', async () => {
		const { creator, users } = await crowd(20);
		const { id, questions } = await makeForm(creator);

		const { outcomes, closed } = await withSlowWrites(
			{ table: 'response', formId: id, seconds: 0.15 },
			async () => {
				const early = users.slice(0, 10).map((u) => settle(submit(id, u, [TARGET_ROLE], inputs(questions, { 0: 'x' }))));
				await sleep(50);
				const closing = settle(closeForm(id));
				await sleep(50);
				const late = users.slice(10).map((u) => settle(submit(id, u, [TARGET_ROLE], inputs(questions, { 0: 'x' }))));
				return { outcomes: await Promise.all([...early, ...late]), closed: await closing };
			}
		);

		expect(closed.ok && closed.value.ok).toBe(true);
		const reasons = outcomes.map((o) => (o.ok ? (o.value.ok ? 'ok' : o.value.reason) : `error ${o.code}`));
		expect(reasons.every((r) => r === 'ok' || r === 'closed')).toBe(true);

		const responders = new Set(
			(await db.select({ discordId: response.discordId }).from(response).where(eq(response.formId, id))).map(
				(r) => r.discordId
			)
		);
		users.forEach((u, i) => expect(responders.has(u.discordId)).toBe(reasons[i] === 'ok'));

		const [row] = await db.select().from(form).where(eq(form.id, id));
		const frozen = new Set(row.finalNonSubmitters!.map((m) => m.discordId));
		const targets = row.finalTargetIds!;
		expect([...frozen].filter((d) => responders.has(d))).toEqual([]);
		// Every frozen target is exactly one of the two.
		expect(targets.filter((d) => responders.has(d) === frozen.has(d))).toEqual([]);
	}, 20_000);
});
