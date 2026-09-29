import { plugin } from 'bun';
import { afterAll, beforeEach } from 'bun:test';
import { discord, GUILD_ID, installDiscordStub } from '../helpers/discord';
import { createTempDb, type TempDb } from '../helpers/temp-db';

// bun test runs the test files even after a preload throws, so every setup failure exits instead.
function fatal(message: string): never {
	console.error(`\ntest setup failed: ${message}\n`);
	process.exit(1);
}

// Bun loads .env on its own, so DATABASE_URL names the dev database here. Only its server is used,
// and it is replaced at once so that nothing, not even a half-finished setup, can reach that database.
const devUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = 'postgres://temporary-database-not-ready.invalid/none';
if (!devUrl) fatal('DATABASE_URL is not set. Copy .env.example to .env first.');

// Overwritten rather than defaulted: a real token or secret from .env must never reach a test.
Object.assign(process.env, {
	DISCORD_BOT_TOKEN: 'test-bot-token',
	DISCORD_GUILD_ID: GUILD_ID,
	DISCORD_CLIENT_ID: 'test-client-id',
	DISCORD_CLIENT_SECRET: 'test-client-secret',
	BETTER_AUTH_SECRET: 'test-better-auth-secret-0123456789abcdef',
	BETTER_AUTH_URL: 'http://forms.test',
	ORIGIN: 'http://forms.test'
});
delete process.env.CRON_SECRET;

plugin({
	name: 'sveltekit-virtual-modules',
	setup(build) {
		build.module('$env/dynamic/private', () => ({
			exports: { env: process.env },
			loader: 'object'
		}));
		build.module('$app/environment', () => ({
			exports: { building: false, dev: false, browser: false, version: 'test' },
			loader: 'object'
		}));
		build.module('$app/server', () => ({
			exports: {
				getRequestEvent: () => {
					throw new Error('no request event in tests');
				}
			},
			loader: 'object'
		}));
	}
});

installDiscordStub();

let temp: TempDb;
try {
	temp = await createTempDb(devUrl);
} catch (e) {
	fatal((e as Error).message);
}

let dropped: Promise<void> | null = null;
const dropTemp = () => (dropped ??= temp.drop());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		dropTemp().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
	});
}

process.env.DATABASE_URL = temp.url;

const { db } = await import('../../src/lib/server/db/index.ts');
const [{ current }] = await db.$client<{ current: string }[]>`select current_database() as current`;
if (current !== temp.name) {
	await dropTemp();
	fatal(`the app's database client points at ${current}, not at the temporary database`);
}

const { resetTables } = await import('../helpers/fixtures');

beforeEach(async () => {
	discord.reset();
	await resetTables();
});

afterAll(async () => {
	await db.$client.end({ timeout: 1 });
	await dropTemp();
});
