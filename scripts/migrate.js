import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// drizzle-kit is a devDependency, so the runtime image drives the migrator directly.
// Only drizzle-orm + postgres (both production dependencies) and the drizzle/ folder are needed.
const migrationsFolder = join(dirname(dirname(fileURLToPath(import.meta.url))), 'drizzle');

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}

// max: 1 because the migrator runs every statement on one connection anyway.
const client = postgres(url, { max: 1, onnotice: () => {} });

try {
	await migrate(drizzle(client), { migrationsFolder });
	console.log('migrations up to date');
} catch (cause) {
	console.error('migration failed', cause);
	process.exitCode = 1;
} finally {
	await client.end();
}
