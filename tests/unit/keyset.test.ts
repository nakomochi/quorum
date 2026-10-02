import { describe, expect, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { form } from '$lib/server/db/schema';
import {
	decodeCursor,
	encodeCursor,
	fetchPage,
	FIRST_PAGE,
	keyset,
	readPageRequest,
	type Cursor,
	type PageRequest
} from '$lib/server/keyset';

const anyId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

describe('cursor', () => {
	test('round-trips the microseconds and the id, as a short base64url string', () => {
		for (const cursor of [
			{ at: 1790000000123456n, id: 'V1StGXR8_Z5j' },
			{ at: 0n, id: '-' },
			{ at: 1n, id: '42' }
		]) {
			const encoded = encodeCursor(cursor);
			expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(encoded.length).toBeLessThan(40);
			expect(decodeCursor(encoded, anyId)).toEqual(cursor);
		}
	});

	test('anything it did not write reads as no cursor, never a throw', () => {
		const b64 = (text: string) => Buffer.from(text).toString('base64url');
		for (const raw of [
			'',
			'!!!',
			'a+b/c=',
			b64('1790000000123456'),
			b64('.abc'),
			b64('-5.abc'),
			b64('1e9.abc'),
			b64('9999999999999999999.abc'),
			b64('253402300800000000.abc'),
			b64('1790000000123456.'),
			b64('1790000000123456.a b'),
			b64('1790000000123456.' + 'x'.repeat(65)),
			'x'.repeat(201)
		]) {
			expect(decodeCursor(raw, anyId)).toBeNull();
		}
	});

	test('the list decides which ids it accepts', () => {
		const raw = encodeCursor({ at: 1n, id: 'abc' });
		expect(decodeCursor(raw, (id) => /^\d+$/.test(id))).toBeNull();
	});

	test('a request is `before`, else `after`, else the first page; a bad cursor is the first page', () => {
		const cursor = { at: 5n, id: 'abc' };
		const raw = encodeCursor(cursor);
		const read = (query: string) => readPageRequest(new URLSearchParams(query), anyId);

		expect(read('')).toEqual(FIRST_PAGE);
		expect(read(`before=${raw}`)).toEqual({ kind: 'before', cursor });
		expect(read(`after=${raw}`)).toEqual({ kind: 'after', cursor });
		expect(read(`before=${raw}&after=xyz`)).toEqual({ kind: 'before', cursor });
		expect(read('before=%%%')).toEqual(FIRST_PAGE);
		expect(read('after=')).toEqual(FIRST_PAGE);
	});
});

describe('keyset', () => {
	const dialect = new PgDialect();
	const cursor: Cursor = { at: 1790000000123456n, id: 'abc' };

	test('the first page has no bound and walks down', () => {
		const { where, orderBy } = keyset(form.createdAt, form.id, FIRST_PAGE);
		expect(where).toBeUndefined();
		expect(orderBy.map((part) => dialect.sqlToQuery(part).sql)).toEqual([
			'"form"."created_at" desc',
			'"form"."id" desc'
		]);
	});

	test('`before` and `after` mirror each other, bound at full precision and typed by the id column', () => {
		const before = keyset(form.createdAt, form.id, { kind: 'before', cursor });
		const after = keyset(form.createdAt, form.id, { kind: 'after', cursor });

		const bound = '($1::timestamptz, $2::text)';
		expect(dialect.sqlToQuery(before.where!)).toEqual({
			sql: `("form"."created_at", "form"."id") < ${bound}`,
			params: ['2026-09-21T14:13:20.123456Z', 'abc'],
			typings: expect.anything()
		});
		expect(dialect.sqlToQuery(after.where!).sql).toBe(
			`("form"."created_at", "form"."id") > ${bound}`
		);
		expect(before.orderBy.map((part) => dialect.sqlToQuery(part).sql)).toEqual([
			'"form"."created_at" desc',
			'"form"."id" desc'
		]);
		expect(after.orderBy.map((part) => dialect.sqlToQuery(part).sql)).toEqual([
			'"form"."created_at" asc',
			'"form"."id" asc'
		]);
	});
});

type Row = { sortKey: string; key: string };

/** What the database does with keyset()'s query, over rows kept newest first. */
function memoryFetch(table: { rows: Row[] }) {
	const compare = (a: { at: bigint; id: string }, b: { at: bigint; id: string }) =>
		a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.at < b.at ? -1 : 1;
	const tuple = (row: Row) => ({ at: BigInt(row.sortKey), id: row.key });

	return async (request: PageRequest, limit: number): Promise<Row[]> => {
		const sorted = [...table.rows].sort((a, b) => compare(tuple(b), tuple(a)));
		if (request.kind === 'first') return sorted.slice(0, limit);
		if (request.kind === 'before') {
			return sorted.filter((row) => compare(tuple(row), request.cursor) < 0).slice(0, limit);
		}
		return sorted
			.filter((row) => compare(tuple(row), request.cursor) > 0)
			.reverse()
			.slice(0, limit);
	};
}

/** `count` rows, `tied` of them in a row sharing one time; ids padded so text order is numeric. */
function rowsOf(count: number, tied: [from: number, to: number] = [0, 0]): Row[] {
	return Array.from({ length: count }, (_, i) => ({
		sortKey: String(1_000_000_000n - BigInt(i >= tied[0] && i < tied[1] ? tied[0] : i)),
		key: String(count - i).padStart(4, '0')
	}));
}

const asRequest = (kind: 'before' | 'after', raw: string): PageRequest => ({
	kind,
	cursor: decodeCursor(raw, anyId)!
});

describe('fetchPage', () => {
	test('walks every row once, in order, through ties that straddle the page breaks', async () => {
		const table = { rows: rowsOf(47, [15, 45]) };
		const fetch = memoryFetch(table);

		const seen: string[] = [];
		let page = await fetchPage(FIRST_PAGE, 20, fetch);
		expect(page.newer).toBeNull();
		seen.push(...page.rows.map((row) => row.key));
		while (page.older) {
			page = await fetchPage(asRequest('before', page.older), 20, fetch);
			expect(page.newer).not.toBeNull();
			seen.push(...page.rows.map((row) => row.key));
		}

		expect(seen).toEqual((await fetch(FIRST_PAGE, 100)).map((row) => row.key));
		expect(new Set(seen).size).toBe(47);
	});

	test('`after` comes back up through exactly the pages `before` went down', async () => {
		const fetch = memoryFetch({ rows: rowsOf(47, [18, 23]) });

		const down = [await fetchPage(FIRST_PAGE, 20, fetch)];
		while (down.at(-1)!.older)
			down.push(await fetchPage(asRequest('before', down.at(-1)!.older!), 20, fetch));
		expect(down.map((page) => page.rows.length)).toEqual([20, 20, 7]);

		const up = [down.at(-1)!];
		while (up.at(-1)!.newer)
			up.push(await fetchPage(asRequest('after', up.at(-1)!.newer!), 20, fetch));

		expect(up.reverse().map((page) => page.rows)).toEqual(down.map((page) => page.rows));
		expect(up[0].newer).toBeNull();
	});

	test('rows added in front between loads neither repeat nor shift the next page', async () => {
		const table = { rows: rowsOf(30) };
		const fetch = memoryFetch(table);

		const first = await fetchPage(FIRST_PAGE, 20, fetch);
		table.rows = [
			{ sortKey: '2000000000', key: '9001' },
			{ sortKey: '2000000000', key: '9002' },
			...table.rows
		];
		const second = await fetchPage(asRequest('before', first.older!), 20, fetch);

		expect([...first.rows, ...second.rows].map((row) => row.key)).toEqual(
			rowsOf(30).map((row) => row.key)
		);
		expect(second.older).toBeNull();
		// Back up from there: the 20 just above, then the added rows on top of a full first page.
		const back = await fetchPage(asRequest('after', second.newer!), 20, fetch);
		expect(back.rows).toEqual(first.rows);
		expect(back.newer).not.toBeNull();
		const top = await fetchPage(asRequest('after', back.newer!), 20, fetch);
		expect(top.rows.map((row) => row.key)).toEqual([
			'9002',
			'9001',
			...first.rows.slice(0, 18).map((row) => row.key)
		]);
		expect(top.newer).toBeNull();
	});

	test('an `after` page that reaches the top is the first page, full', async () => {
		const fetch = memoryFetch({ rows: rowsOf(25) });
		const first = await fetchPage(FIRST_PAGE, 20, fetch);
		const nearTop = first.rows[3];

		const page = await fetchPage(
			{ kind: 'after', cursor: { at: BigInt(nearTop.sortKey), id: nearTop.key } },
			20,
			fetch
		);

		expect(page).toEqual(first);
	});

	test('a page past the oldest row is empty and leads back up from its cursor', async () => {
		const fetch = memoryFetch({ rows: rowsOf(5) });
		const cursor = { at: 1n, id: '0000' };

		const page = await fetchPage({ kind: 'before', cursor }, 20, fetch);

		expect(page).toEqual({ rows: [], older: null, newer: encodeCursor(cursor) });
	});

	test('no rows: no page either way', async () => {
		expect(await fetchPage(FIRST_PAGE, 20, memoryFetch({ rows: [] }))).toEqual({
			rows: [],
			older: null,
			newer: null
		});
	});
});
