import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { db } from './db';
import * as schema from './db/schema';

export const auth = betterAuth({
	// Same reason as db/index.ts: `vite build` imports this module, and better-auth treats a
	// missing secret as fatal under NODE_ENV=production. The placeholder only exists while
	// building, so a real deploy still fails on a missing BETTER_AUTH_SECRET.
	secret: env.BETTER_AUTH_SECRET ?? (building ? 'build-time-placeholder-secret' : undefined),
	baseURL: env.BETTER_AUTH_URL,
	database: drizzleAdapter(db, { provider: 'pg', schema }),
	user: {
		additionalFields: {
			discordId: {
				type: 'string',
				// `input: false` must NOT be set here. On sign-up better-auth calls
				// parseAdditionalUserInputFromProviderProfile, which drops every field whose
				// schema says `input === false`, and parseInputData then throws BAD_REQUEST
				// ("discordId is required") because the field is required on create.
				// Client input is instead neutralised by the user.update database hook below.
				required: true
			}
		}
	},
	databaseHooks: {
		user: {
			update: {
				// discordId is owned by the OAuth profile. Without this, POST /api/auth/update-user
				// would let a signed-in user claim the snowflake of a guild member who has never
				// logged in (the unique index only protects snowflakes already in the table).
				// The key must be deleted from the incoming object rather than merely omitted from
				// the return value: better-auth merges the result as `{ ...actualData, ...data }`.
				before: async (user) => {
					if (!('discordId' in user)) return;
					delete user.discordId;
					return { data: user };
				}
			}
		}
	},
	socialProviders: {
		discord: {
			clientId: env.DISCORD_CLIENT_ID ?? '',
			clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
			mapProfileToUser: (profile) => ({
				name: profile.global_name ?? profile.username,
				// Discord returns no email for phone-only accounts, but user.email is NOT NULL.
				email: profile.email ?? `${profile.id}@discord.local`,
				image: profile.image_url,
				// better-auth generates its own user.id, so keep the snowflake separately.
				discordId: profile.id
			})
		}
	},
	plugins: [sveltekitCookies(getRequestEvent)]
});

export type Session = typeof auth.$Infer.Session.session;
export type SessionUser = typeof auth.$Infer.Session.user;
