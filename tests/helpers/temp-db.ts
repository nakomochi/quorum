import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const PREFIX = 'formdiscord_test_';
const MIGRATIONS = join(import.meta.dir, '..', '..', 'drizzle');

export type TempDb = { name: string; url: string; drop: () => Promise<void> };

function withDatabase(base: string, database: string): string {
	const url = new URL(base);
	url.pathname = `/${database}`;
	return url.toString();
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Connects to the server's maintenance database, never to the one DATABASE_URL names. */
async function connectAdmin(base: string) {
	const sql = postgres(withDatabase(base, 'postgres'), {
		max: 1,
		connect_timeout: 5,
		onnotice: () => {}
	});
	try {
		await sql`select 1`;
	} catch (cause) {
		await sql.end({ timeout: 0 });
		const { hostname, port } = new URL(base);
		throw new Error(
			`Cannot reach Postgres at ${hostname}:${port || 5432} (${(cause as Error).message}). ` +
				'Start it with `bun run db:start` and run the tests again.',
			{ cause }
		);
	}
	return sql;
}

/**
 * Creates a uniquely named database on DATABASE_URL's server and applies every migration the way
 * scripts/migrate.js does. Databases left by runs whose process is gone are dropped first.
 */
export async function createTempDb(base: string): Promise<TempDb> {
	const admin = await connectAdmin(base);
	const name = `${PREFIX}${process.pid}_${Date.now().toString(36)}`;

	try {
		const stale = await admin<{ datname: string }[]>`
			select datname from pg_database where datname like ${`${PREFIX}%`}`;
		for (const { datname } of stale) {
			const pid = Number(datname.slice(PREFIX.length).split('_')[0]);
			if (!Number.isInteger(pid) || isAlive(pid)) continue;
			await admin.unsafe(`drop database if exists "${datname}" with (force)`);
		}
		await admin.unsafe(`create database "${name}"`);
	} catch (e) {
		await admin.end({ timeout: 0 });
		throw e;
	}

	const url = withDatabase(base, name);
	const drop = async () => {
		await admin.unsafe(`drop database if exists "${name}" with (force)`);
		await admin.end({ timeout: 0 });
	};

	const client = postgres(url, { max: 1, onnotice: () => {} });
	try {
		await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
	} catch (e) {
		await client.end({ timeout: 0 });
		await drop();
		throw e;
	}
	await client.end({ timeout: 0 });

	return { name, url, drop };
}
