import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { db } from './db';
import * as schema from './db/schema';
import { syncOwnMember } from './guild-sync';

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
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
		},
		session: {
			create: {
				/**
				 * The only hook that runs on every sign-in. better-auth inserts a fresh session row
				 * per sign-in (internalAdapter.createSession has no reuse path), whereas
				 * user.create.after fires once and user.update.after not at all for a repeat social
				 * login.
				 */
				after: async (session) => {
					try {
						const [row] = await db
							.select({ discordId: schema.user.discordId })
							.from(schema.user)
							.where(eq(schema.user.id, session.userId))
							.limit(1);

						if (row) await syncOwnMember(row.discordId);
					} catch (error) {
						// A throw here propagates out of the sign-in request, so a Discord outage
						// would lock everyone out. Log it and let the login stand.
						console.error('[guild-sync] login sync failed', error);
					}
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
