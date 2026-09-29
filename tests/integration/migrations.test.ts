import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '$lib/server/db';

describe('migrations', () => {
	test('every migration in drizzle/ applied to the empty temporary database', async () => {
		const journal = JSON.parse(
			readFileSync(join(import.meta.dir, '..', '..', 'drizzle', 'meta', '_journal.json'), 'utf8')
		) as { entries: unknown[] };

		const [{ applied }] = await db.$client<{ applied: number }[]>`
			select count(*)::int as applied from drizzle.__drizzle_migrations`;
		expect(applied).toBe(journal.entries.length);

		const tables = await db.$client<{ name: string }[]>`
			select table_name as name from information_schema.tables where table_schema = 'public'`;
		expect(tables.map((t) => t.name).sort()).toEqual(
			[
				'account',
				'answer',
				'form',
				'guild_member',
				'guild_sync',
				'question',
				'reminder',
				'response',
				'response_revision',
				'session',
				'user',
				'verification'
			].sort()
		);
	});
});
