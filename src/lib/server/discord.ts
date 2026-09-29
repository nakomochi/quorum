import { env } from '$env/dynamic/private';

const API_BASE = 'https://discord.com/api/v10';

// Discord requires a descriptive User-Agent on every REST call.
const USER_AGENT = 'DiscordBot (https://github.com/nakomochi/quorum, 0.0.1)';

const MEMBER_PAGE_SIZE = 1000;
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RETRY_AFTER_MS = 60_000;

// Without this a stalled connection hangs the caller: a gate's member lookup runs inside a page
// request, where try/catch cannot rescue a fetch that never settles.
const REQUEST_TIMEOUT_MS = 10_000;

export const GUILD_TEXT_CHANNEL = 0;

export type DiscordUser = {
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
	bot?: boolean;
};

export type DiscordGuildMember = {
	user: DiscordUser;
	nick: string | null;
	/** The server profile's avatar hash, apart from the account's `user.avatar`. */
	avatar: string | null;
	roles: string[];
	joined_at: string;
};

export type DiscordRole = {
	id: string;
	name: string;
	color: number;
	position: number;
	/** Bitfield wider than Number.MAX_SAFE_INTEGER; parse with BigInt, never Number. */
	permissions: string;
	managed: boolean;
	mentionable: boolean;
};

export type DiscordChannel = {
	id: string;
	name: string;
	type: number;
	position: number;
	parent_id: string | null;
};

export type DiscordGuild = {
	id: string;
	name: string;
	icon: string | null;
	owner_id: string;
};

export type DiscordMessage = {
	id: string;
	channel_id: string;
};

/**
 * `parse: []` suppresses @everyone/@here and role pings that happen to appear in the body, so only
 * the snowflakes listed in `users` and `roles` are notified.
 */
export type AllowedMentions = {
	parse: never[];
	users?: string[];
	roles?: string[];
	replied_user?: boolean;
};

export type MessageReference = {
	message_id: string;
	/** False so a deleted target degrades to a plain message instead of failing the whole post. */
	fail_if_not_exists: false;
};

export type CreateMessage = {
	content: string;
	allowed_mentions: AllowedMentions;
	message_reference?: MessageReference;
};

export class DiscordApiError extends Error {
	constructor(
		readonly status: number,
		readonly path: string,
		readonly body: string,
		message?: string
	) {
		super(message ?? `Discord API ${status} on ${path}: ${body}`);
		this.name = 'DiscordApiError';
	}
}

function credentials() {
	const token = env.DISCORD_BOT_TOKEN;
	const guildId = env.DISCORD_GUILD_ID;
	if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');
	if (!guildId) throw new Error('DISCORD_GUILD_ID is not set');
	return { token, guildId };
}

export function guildId(): string {
	return credentials().guildId;
}

/** A link that opens the message in Discord. Built locally; nothing is asked of the API. */
export function messageUrl(channelId: string, messageId: string): string {
	return `https://discord.com/channels/${guildId()}/${channelId}/${messageId}`;
}

const CDN_BASE = 'https://cdn.discordapp.com';
const AVATAR_SIZE = 64;

/**
 * The server avatar, else the account avatar, as a static PNG (animated ones too). Null when there
 * is neither. Built locally; nothing is asked of the API.
 */
export function memberAvatarUrl(
	userId: string,
	guildAvatarHash: string | null,
	avatarHash: string | null
): string | null {
	if (guildAvatarHash) {
		return `${CDN_BASE}/guilds/${guildId()}/users/${userId}/avatars/${guildAvatarHash}.png?size=${AVATAR_SIZE}`;
	}
	if (avatarHash) return `${CDN_BASE}/avatars/${userId}/${avatarHash}.png?size=${AVATAR_SIZE}`;
	return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryAfterMs(res: Response): Promise<number> {
	const header = Number(res.headers.get('retry-after'));
	let seconds = Number.isFinite(header) ? header : 0;

	// The JSON body carries sub-second precision that the header rounds away.
	try {
		const body = (await res.clone().json()) as { retry_after?: number };
		if (typeof body.retry_after === 'number') seconds = body.retry_after;
	} catch {
		// Non-JSON 429 (e.g. Cloudflare ban page); fall back to the header.
	}

	return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS);
}

async function request(path: string, init: { method?: string; json?: unknown } = {}) {
	const { token } = credentials();
	const body = init.json === undefined ? undefined : JSON.stringify(init.json);

	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${API_BASE}${path}`, {
			method: init.method ?? 'GET',
			headers: {
				Authorization: `Bot ${token}`,
				'User-Agent': USER_AGENT,
				Accept: 'application/json',
				...(body === undefined ? {} : { 'Content-Type': 'application/json' })
			},
			body,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});

		if (res.status !== 429) return res;

		if (attempt >= MAX_RATE_LIMIT_RETRIES) {
			throw new DiscordApiError(
				429,
				path,
				await res.text(),
				`Discord API rate limit not cleared after ${MAX_RATE_LIMIT_RETRIES} retries on ${path}`
			);
		}

		await sleep(await retryAfterMs(res));
	}
}

async function toError(res: Response, path: string, message?: string) {
	return new DiscordApiError(res.status, path, await res.text(), message);
}

async function getJson<T>(path: string): Promise<T> {
	const res = await request(path);
	if (!res.ok) throw await toError(res, path);
	return (await res.json()) as T;
}

/**
 * Listing members is the one call gated by a privileged intent, and Discord reports the
 * missing intent as a generic 403 "Missing Access" that says nothing about the cause.
 */
async function toMemberListError(res: Response, path: string) {
	const body = await res.text();
	if (res.status !== 401 && res.status !== 403) {
		return new DiscordApiError(res.status, path, body);
	}
	return new DiscordApiError(
		res.status,
		path,
		body,
		`Discord API ${res.status} while listing guild members: ${body}. ` +
			'The usual cause is that the SERVER MEMBERS INTENT is disabled for this bot. ' +
			'Enable it under Discord Developer Portal > Applications > (your app) > Bot > ' +
			'Privileged Gateway Intents > Server Members Intent, then retry. ' +
			'Also verify the bot is a member of DISCORD_GUILD_ID and that DISCORD_BOT_TOKEN is current.'
	);
}

/** Every guild member, paged. Callers filter by role: Discord exposes no role-scoped listing. */
export async function listGuildMembers(): Promise<DiscordGuildMember[]> {
	const id = guildId();
	const members: DiscordGuildMember[] = [];
	let after = '0';

	for (;;) {
		// `limit` must be explicit: Discord defaults it to 1.
		const path = `/guilds/${id}/members?limit=${MEMBER_PAGE_SIZE}&after=${after}`;
		const res = await request(path);
		if (!res.ok) throw await toMemberListError(res, path);

		const page = (await res.json()) as DiscordGuildMember[];
		members.push(...page);
		if (page.length < MEMBER_PAGE_SIZE) return members;

		// The page is ordered by user id, so the last entry is the highest id seen.
		after = page[page.length - 1].user.id;
	}
}

/** Null when the user is not in the guild. */
export async function getGuildMember(userId: string): Promise<DiscordGuildMember | null> {
	const path = `/guilds/${guildId()}/members/${userId}`;
	const res = await request(path);
	if (res.status === 404) return null;
	if (!res.ok) throw await toError(res, path);
	return (await res.json()) as DiscordGuildMember;
}

export async function listGuildRoles(): Promise<DiscordRole[]> {
	return getJson<DiscordRole[]>(`/guilds/${guildId()}/roles`);
}

export async function listGuildChannels(): Promise<DiscordChannel[]> {
	const channels = await getJson<DiscordChannel[]>(`/guilds/${guildId()}/channels`);
	return channels.filter((channel) => channel.type === GUILD_TEXT_CHANNEL);
}

export async function getGuild(): Promise<DiscordGuild> {
	return getJson<DiscordGuild>(`/guilds/${guildId()}`);
}

export async function postMessage(
	channelId: string,
	message: CreateMessage
): Promise<DiscordMessage> {
	const path = `/channels/${channelId}/messages`;
	const res = await request(path, { method: 'POST', json: message });
	if (!res.ok) throw await toError(res, path);
	return (await res.json()) as DiscordMessage;
}
