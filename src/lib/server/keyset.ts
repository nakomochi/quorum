import { asc, desc, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Keyset paging of a list shown newest first: rows are ordered by a timestamp, ties broken by id,
 * both descending. A cursor names one row by those two values, so a page never repeats or skips a
 * row however many rows are added in front of it between loads.
 */

/** `at` is the sort timestamp in microseconds since the epoch, as Postgres stores it. */
export type Cursor = { at: bigint; id: string };

export type PageRequest =
	| { kind: 'first' }
	/** Rows older than the cursor. */
	| { kind: 'before'; cursor: Cursor }
	/** Rows newer than the cursor. */
	| { kind: 'after'; cursor: Cursor };

export const FIRST_PAGE: PageRequest = { kind: 'first' };

export const PAGE_SIZE = 20;

// Up to the year 9999, which no timestamptz in this app reaches.
const MAX_AT = 253402300800000000n;
const SEPARATOR = '.';

export function encodeCursor(cursor: Cursor): string {
	return Buffer.from(`${cursor.at}${SEPARATOR}${cursor.id}`).toString('base64url');
}

/** Null for anything this module did not write, or whose id `isId` refuses. Never throws. */
export function decodeCursor(raw: string, isId: (id: string) => boolean): Cursor | null {
	if (raw.length === 0 || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
	const text = Buffer.from(raw, 'base64url').toString('utf8');
	const split = text.indexOf(SEPARATOR);
	if (split < 1) return null;
	const at = text.slice(0, split);
	const id = text.slice(split + 1);
	if (!/^\d{1,18}$/.test(at) || !isId(id)) return null;
	const micros = BigInt(at);
	return micros < MAX_AT ? { at: micros, id } : null;
}

/** `?before=` wins over `?after=`; an unreadable cursor is the first page rather than an error. */
export function readPageRequest(params: URLSearchParams, isId: (id: string) => boolean): PageRequest {
	for (const kind of ['before', 'after'] as const) {
		const raw = params.get(kind);
		if (raw === null) continue;
		const cursor = decodeCursor(raw, isId);
		return cursor ? { kind, cursor } : FIRST_PAGE;
	}
	return FIRST_PAGE;
}

/** The timestamp as Postgres compares it: `Date` would round it to milliseconds. */
function timestampOf(at: bigint): string {
	const millis = at / 1000n;
	const rest = (at % 1000n).toString().padStart(3, '0');
	return new Date(Number(millis)).toISOString().replace('Z', `${rest}Z`);
}

/** Selected next to each row: the sort timestamp at full precision, for its cursor. */
export function sortKey(column: PgColumn): SQL<string> {
	return sql<string>`(extract(epoch from ${column}) * 1000000)::bigint::text`;
}

/**
 * The WHERE and ORDER BY of one request. An `after` page walks upwards from the cursor, so it is
 * read ascending and turned round by `fetchPage`. The tuple comparison matches an index on
 * (…, sortColumn, idColumn).
 */
export function keyset(
	sortColumn: PgColumn,
	idColumn: PgColumn,
	request: PageRequest
): { where: SQL | undefined; orderBy: SQL[] } {
	if (request.kind === 'first') {
		return { where: undefined, orderBy: [desc(sortColumn), desc(idColumn)] };
	}
	const { at, id } = request.cursor;
	const bound = sql`(${timestampOf(at)}::timestamptz, ${id}::${sql.raw(idColumn.getSQLType())})`;
	return request.kind === 'before'
		? { where: sql`(${sortColumn}, ${idColumn}) < ${bound}`, orderBy: [desc(sortColumn), desc(idColumn)] }
		: { where: sql`(${sortColumn}, ${idColumn}) > ${bound}`, orderBy: [asc(sortColumn), asc(idColumn)] };
}

/** What a fetched row must carry for its cursor: `sortKey`'s value and the tie-breaking id. */
export type Keyed = { sortKey: string; key: string | number };

export type Page<Row> = {
	/** Newest first. */
	rows: Row[];
	/** For `?before=`: null when nothing is older. */
	older: string | null;
	/** For `?after=`: null when nothing is newer. */
	newer: string | null;
};

const cursorOf = (row: Keyed) => encodeCursor({ at: BigInt(row.sortKey), id: String(row.key) });

/**
 * One page of at most `size` rows. `fetch` runs `keyset(…, request)` with the limit it is given:
 * one more than shown, which tells whether a page lies beyond in the walking direction. The other
 * direction is taken to exist, since the cursor came from a row on screen. An `after` page that
 * reaches the newest row is the first page instead, so the top of the list always shows in full.
 */
export async function fetchPage<Row extends Keyed>(
	request: PageRequest,
	size: number,
	fetch: (request: PageRequest, limit: number) => Promise<Row[]>
): Promise<Page<Row>> {
	const rows = await fetch(request, size + 1);
	const beyond = rows.length > size;
	const shown = rows.slice(0, size);

	if (request.kind === 'after') {
		if (!beyond) return fetchPage(FIRST_PAGE, size, fetch);
		shown.reverse();
		return { rows: shown, older: cursorOf(shown[shown.length - 1]), newer: cursorOf(shown[0]) };
	}

	const older = beyond ? cursorOf(shown[shown.length - 1]) : null;
	if (request.kind === 'first') return { rows: shown, older, newer: null };
	// An empty page past the oldest row still leads back up.
	const newer = shown.length > 0 ? cursorOf(shown[0]) : encodeCursor(request.cursor);
	return { rows: shown, older, newer };
}
