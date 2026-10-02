import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { form, response, type Form } from '$lib/server/db/schema';
import {
	listPendingForms,
	pageAllForms,
	pageCreatedForms,
	pageSubmittedForms,
	type ListPage
} from '$lib/server/form-lists';
import { canSubmit, isClosed, type MemberContext } from '$lib/server/forms';
import { decodeCursor, FIRST_PAGE, type PageRequest } from '$lib/server/keyset';
import { load as topLoad } from '../../src/routes/+page.server';
import { load as submittedLoad } from '../../src/routes/forms/submitted/+page.server';
import { load as createdLoad } from '../../src/routes/forms/created/+page.server';
import { OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	member,
	seedGuild,
	sessionLocals,
	snowflake,
	type TestUser
} from '../helpers/fixtures';

const anyId = () => true;

/** A time with microseconds, which a JS Date cannot hold: ties to the millisecond stay apart. */
const micros = (n: number) => sql`'2026-03-01T00:00:00Z'::timestamptz + ${n} * interval '1 microsecond'`;

/** Inserted directly, all at once: the lists read nothing but these columns. */
async function insertForms(
	creator: TestUser,
	count: number,
	at: (i: number) => number,
	extra: (i: number) => Partial<typeof form.$inferInsert> = () => ({})
): Promise<string[]> {
	const rows = await db
		.insert(form)
		.values(
			Array.from({ length: count }, (_, i) => ({
				id: `f${String(i).padStart(4, '0')}${'x'.repeat(7)}`,
				title: `フォーム${i}`,
				createdBy: creator.id,
				targetRoleId: null,
				createdAt: micros(at(i)) as unknown as Date,
				...extra(i)
			}))
		)
		.returning({ id: form.id });
	return rows.map((row) => row.id);
}

/** The list's order as the database sorts it outright. */
async function orderOfForms(): Promise<string[]> {
	const rows = await db.execute<{ id: string }>(sql`select id from form order by created_at desc, id desc`);
	return [...rows].map((row) => row.id);
}

async function walkDown<Row>(
	load: (request: PageRequest) => Promise<ListPage<Row>>,
	between: (pageIndex: number) => Promise<void> = async () => {}
) {
	const pages: ListPage<Row>[] = [await load(FIRST_PAGE)];
	while (pages.at(-1)!.older) {
		await between(pages.length);
		pages.push(await load({ kind: 'before', cursor: decodeCursor(pages.at(-1)!.older!, anyId)! }));
	}
	return pages;
}

async function walkUp<Row>(load: (request: PageRequest) => Promise<ListPage<Row>>, from: ListPage<Row>) {
	const pages = [from];
	while (pages.at(-1)!.newer) {
		pages.push(await load({ kind: 'after', cursor: decodeCursor(pages.at(-1)!.newer!, anyId)! }));
	}
	return pages.reverse();
}

const event = (who: TestUser, path: string) =>
	({ locals: sessionLocals(who), params: {}, url: new URL(`http://forms.test${path}`) }) as never;

describe('who sees which form', () => {
	test('the SQL filters agree with canSubmit and isClosed over every combination', async () => {
		const [creator, viewer] = await createUsers([snowflake(1), snowflake(2)]);
		const now = new Date();
		const hour = 3_600_000;
		const closures: Partial<Form>[] = [
			{},
			{ closesAt: new Date(now.getTime() + hour) },
			{ closesAt: new Date(now.getTime() - hour) },
			{ closesAt: new Date(now.getTime() - hour), closedAt: new Date(now.getTime() - hour) },
			{ closedAt: new Date(now.getTime() - hour) }
		];
		const combos = (['everyone', 'target_role'] as const).flatMap((submitScope) =>
			[null, TARGET_ROLE, OTHER_ROLE].flatMap((targetRoleId) =>
				closures.map((closure) => ({ submitScope, targetRoleId, closesAt: null, closedAt: null, ...closure }))
			)
		);
		const ids = await insertForms(creator, combos.length, (i) => i, (i) => combos[i]);
		const forms = ids.map((id, i) => ({ id, ...combos[i] }));

		const members: MemberContext[] = [
			{ roleIds: [] },
			{ roleIds: [TARGET_ROLE] },
			{ roleIds: [OTHER_ROLE] },
			{ roleIds: [TARGET_ROLE, OTHER_ROLE] },
			{ roleIds: ['200000000000000077'] }
		];
		for (const m of members) {
			const pending = await listPendingForms(m, viewer.id, now);
			expect(pending.map((row) => row.id).sort()).toEqual(
				forms.filter((f) => canSubmit(f, m) && !isClosed(f, now)).map((f) => f.id).sort()
			);
		}

		// Having answered every form: none is pending, and the submitted list is canSubmit's.
		await db.insert(response).values(ids.map((formId) => ({ formId, userId: viewer.id, discordId: viewer.discordId })));
		for (const m of members) {
			expect(await listPendingForms(m, viewer.id, now)).toEqual([]);
			const submitted = await pageSubmittedForms(m, viewer.id, FIRST_PAGE, 100);
			const expected = forms.filter((f) => canSubmit(f, m)).map((f) => f.id);
			expect(submitted.rows.map((row) => row.id).sort()).toEqual(expected.sort());
			expect(submitted.total).toBe(expected.length);
		}
	});

	test('pending: nearest deadline first, none last, then the newest', async () => {
		const [creator, viewer] = await createUsers([snowflake(1), snowflake(2)]);
		const day = (n: number) => new Date(Date.UTC(2030, 0, n));
		const ids = await insertForms(creator, 5, (i) => i, (i) => ({
			deadline: [day(3), null, day(1), day(3), null][i]
		}));

		const pending = await listPendingForms({ roleIds: [] }, viewer.id);

		expect(pending.map((row) => row.id)).toEqual([ids[2], ids[3], ids[0], ids[4], ids[1]]);
		expect(Object.keys(pending[0]).sort()).toEqual(['deadline', 'id', 'title']);
	});
});

describe('keyset pages', () => {
	test('created and admin lists: every row once, in order, across ties within a millisecond', async () => {
		const [creator, other] = await createUsers([snowflake(1), snowflake(2)]);
		// Runs of five sharing a microsecond, every run within one millisecond of the next.
		await insertForms(creator, 47, (i) => Math.floor(i / 5));
		const order = await orderOfForms();

		for (const load of [
			(request: PageRequest) => pageCreatedForms(creator.id, request, 20),
			(request: PageRequest) => pageAllForms(request, 20)
		]) {
			const down = await walkDown(load);
			expect(down.map((page) => page.rows.length)).toEqual([20, 20, 7]);
			expect(down.flatMap((page) => page.rows.map((row) => row.id))).toEqual(order);
			expect(down.map((page) => page.total)).toEqual([47, 47, 47]);
			expect(down[0].newer).toBeNull();
			expect(down[2].older).toBeNull();

			const up = await walkUp(load, down[2]);
			expect(up.map((page) => page.rows)).toEqual(down.map((page) => page.rows));
		}
		expect((await pageCreatedForms(other.id, FIRST_PAGE, 20)).total).toBe(0);
	});

	test('rows added between page loads, ahead and level with the break, neither repeat nor shift the rest', async () => {
		const [creator] = await createUsers([snowflake(1)]);
		await insertForms(creator, 45, (i) => Math.floor(i / 3));
		const before = await orderOfForms();
		const load = (request: PageRequest) => pageCreatedForms(creator.id, request, 20);

		let added = 0;
		const down = await walkDown(load, async () => {
			// One newest, and one tied with every row of the run at the break.
			await db.insert(form).values([
				{ id: `new${added}aaaaaaaa`, title: '追加', createdBy: creator.id, createdAt: micros(1000) as unknown as Date },
				{ id: `new${added}zzzzzzzz`, title: '追加', createdBy: creator.id, createdAt: micros(6) as unknown as Date }
			]);
			added++;
		});

		const seen = down.flatMap((page) => page.rows.map((row) => row.id));
		expect(new Set(seen).size).toBe(seen.length);
		expect(seen.filter((id) => !id.startsWith('new'))).toEqual(before);
	});

	test('submitted list: by submission time, ties broken by the response, ineligible forms left out', async () => {
		const [creator, viewer] = await createUsers([snowflake(1), snowflake(2)]);
		const ids = await insertForms(creator, 30, (i) => i, (i) =>
			i % 10 === 9 ? { targetRoleId: TARGET_ROLE, submitScope: 'target_role' } : {}
		);
		await db.insert(response).values(
			ids.map((formId, i) => ({
				formId,
				userId: viewer.id,
				discordId: viewer.discordId,
				submittedAt: micros(Math.floor(i / 4)) as unknown as Date
			}))
		);
		const expected = [
			...(await db.execute<{ form_id: string }>(
				sql`select r.form_id from response r join form f on f.id = r.form_id
					where f.target_role_id is null order by r.submitted_at desc, r.id desc`
			))
		].map((row) => row.form_id);
		const load = (request: PageRequest) => pageSubmittedForms({ roleIds: [] }, viewer.id, request, 20);

		const down = await walkDown(load);

		expect(expected).toHaveLength(27);
		expect(down.flatMap((page) => page.rows.map((row) => row.id))).toEqual(expected);
		expect(down.map((page) => page.total)).toEqual([27, 27]);
		expect((await walkUp(load, down[1])).map((page) => page.rows)).toEqual(down.map((page) => page.rows));
		expect(Object.keys(down[0].rows[0]).sort()).toEqual(['id', 'revisionCount', 'submittedAt', 'title']);
	});

	test('the admin list counts the forms on its page', async () => {
		const [creator, a] = await createUsers([snowflake(1), snowflake(2)]);
		await seedGuild([member(a.discordId, [TARGET_ROLE])]);
		const ids = await insertForms(creator, 22, (i) => i, (i) => (i === 21 ? { targetRoleId: TARGET_ROLE } : {}));
		await db.insert(response).values({ formId: ids[21], userId: a.id, discordId: a.discordId });

		const first = await pageAllForms(FIRST_PAGE, 20);

		expect(first.rows[0]).toMatchObject({ id: ids[21], submitted: 1, targetCount: 1, outsiders: 0 });
		expect(first.rows[1]).toMatchObject({ id: ids[20], submitted: 0, targetCount: null, outsiders: 0 });
	});
});

describe('the pages', () => {
	async function scene() {
		const [creator, viewer] = await createUsers([snowflake(1), snowflake(2)]);
		await seedGuild([member(creator.discordId, [OTHER_ROLE]), member(viewer.discordId, [TARGET_ROLE])]);
		const ids = await insertForms(creator, 23, (i) => i);
		await db.insert(response).values(
			ids.slice(0, 7).map((formId) => ({ formId, userId: viewer.id, discordId: viewer.discordId }))
		);
		return { creator, viewer, ids };
	}

	test('the top page sends the newest five of each list and how many there are', async () => {
		const { creator, viewer } = await scene();

		const mine = (await topLoad(event(creator, '/'))) as Record<string, unknown[] | number>;
		const theirs = (await topLoad(event(viewer, '/'))) as Record<string, unknown[] | number>;

		expect([(mine.created as unknown[]).length, mine.createdTotal]).toEqual([5, 23]);
		expect([(theirs.submitted as unknown[]).length, theirs.submittedTotal]).toEqual([5, 7]);
		expect((theirs.pending as unknown[]).length).toBe(16);
	});

	test('the list pages page by the URL, and an unreadable cursor is the first page', async () => {
		const { creator, viewer } = await scene();

		const first = (await createdLoad(event(creator, '/forms/created'))) as ListPage<{ id: string }>;
		const second = (await createdLoad(event(creator, `/forms/created?before=${first.older}`))) as ListPage<{
			id: string;
		}>;
		expect([first.rows.length, second.rows.length, first.total]).toEqual([20, 3, 23]);

		for (const query of ['?before=garbage', '?after=%E3%81%82', `?before=${'A'.repeat(500)}`]) {
			expect(await createdLoad(event(creator, `/forms/created${query}`))).toEqual(first);
		}

		const submitted = (await submittedLoad(event(viewer, '/forms/submitted?after=x'))) as ListPage<unknown>;
		expect([submitted.rows.length, submitted.total, submitted.older, submitted.newer]).toEqual([7, 7, null, null]);
	});

	test('a visitor is sent to the top page, and a non-member refused', async () => {
		const [stranger] = await createUsers([snowflake(9)]);
		for (const load of [submittedLoad, createdLoad]) {
			let thrown: unknown;
			try {
				await load({ locals: {}, params: {}, url: new URL('http://forms.test/forms/created') } as never);
			} catch (e) {
				thrown = e;
			}
			expect(thrown).toMatchObject({ status: 303, location: '/' });

			thrown = undefined;
			try {
				await load(event(stranger, '/forms/created'));
			} catch (e) {
				thrown = e;
			}
			expect(thrown).toMatchObject({ status: 403 });
		}
	});
});
