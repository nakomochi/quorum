import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';

// `vite build` imports every server module to read its prerender config, so a hard requirement
// here would make DATABASE_URL a build-time input. Nothing queries the database while building,
// and the placeholder host is deliberately unresolvable so a leak past this guard fails loudly.
if (!building && !env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(env.DATABASE_URL ?? 'postgres://build-time-placeholder.invalid');

export const db = drizzle(client, { schema });
