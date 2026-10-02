import type { DiscordRole } from '../../src/lib/server/discord';

export const GUILD_ID = '100000000000000000';
export const OWNER_ID = '100000000000000999';
export const TARGET_ROLE = '200000000000000001';
export const OTHER_ROLE = '200000000000000002';
export const ADMIN_ROLE = '200000000000000003';
export const CHANNEL_ID = '300000000000000001';

export type StubMember = {
	id: string;
	roles: string[];
	bot?: boolean;
	username?: string;
	globalName?: string | null;
	nick?: string | null;
	avatar?: string | null;
	guildAvatar?: string | null;
};

export type Route = 'listMembers' | 'getMember' | 'roles' | 'channels' | 'guild' | 'post' | 'edit';

export type Call = { route: Route; method: string; url: URL; body: unknown };

/** Returns a response to send instead of the stub's own, or undefined to fall through to it. */
export type Override = (call: Call) => Response | undefined | Promise<Response | undefined>;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function status(code: number, body: unknown = { message: `stub ${code}` }): Response {
	if (code === 429) {
		return new Response(JSON.stringify({ retry_after: 0, ...(body as object) }), {
			status: 429,
			headers: { 'content-type': 'application/json', 'retry-after': '0' }
		});
	}
	return json(body, code);
}

function defaultRoles(): DiscordRole[] {
	const role = (id: string, name: string, permissions: string, position: number): DiscordRole => ({
		id,
		name,
		color: 0,
		position,
		permissions,
		managed: false,
		mentionable: true
	});
	return [
		role(GUILD_ID, '@everyone', '0', 0),
		role(TARGET_ROLE, 'target', '0', 1),
		role(OTHER_ROLE, 'other', '0', 2),
		role(ADMIN_ROLE, 'admin', '8', 3)
	];
}

function toDiscordMember(member: StubMember) {
	return {
		user: {
			id: member.id,
			username: member.username ?? `user${member.id}`,
			global_name: member.globalName ?? null,
			avatar: member.avatar ?? null,
			bot: member.bot ?? false
		},
		nick: member.nick ?? null,
		avatar: member.guildAvatar ?? null,
		roles: member.roles,
		joined_at: '2026-01-01T00:00:00.000Z'
	};
}

function routeOf(method: string, path: string): Route {
	const guild = `/api/v10/guilds/${GUILD_ID}`;
	if (method === 'GET' && path === `${guild}/members`) return 'listMembers';
	if (method === 'GET' && path.startsWith(`${guild}/members/`)) return 'getMember';
	if (method === 'GET' && path === `${guild}/roles`) return 'roles';
	if (method === 'GET' && path === `${guild}/channels`) return 'channels';
	if (method === 'GET' && path === guild) return 'guild';
	if (method === 'POST' && /^\/api\/v10\/channels\/\d+\/messages$/.test(path)) return 'post';
	if (method === 'PATCH' && /^\/api\/v10\/channels\/\d+\/messages\/\d+$/.test(path)) return 'edit';
	throw new Error(`unexpected Discord request: ${method} ${path}`);
}

/** Discord as the app sees it. Reset before every test by the preload. */
class DiscordStub {
	members: StubMember[] = [];
	roles: DiscordRole[] = defaultRoles();
	ownerId = OWNER_ID;
	calls: Call[] = [];
	private overrides = new Map<Route, Override[]>();
	private messageSeq = 0;

	reset() {
		this.members = [];
		this.roles = defaultRoles();
		this.ownerId = OWNER_ID;
		this.calls = [];
		this.overrides.clear();
	}

	/** Overrides run in the order added, until one returns a response. */
	on(route: Route, override: Override) {
		const list = this.overrides.get(route) ?? [];
		list.push(override);
		this.overrides.set(route, list);
	}

	/** Answers `route` with `code` for the next `times` calls, then falls back to the stub. */
	fail(route: Route, code: number, times = Number.POSITIVE_INFINITY) {
		let left = times;
		this.on(route, () => {
			if (left <= 0) return undefined;
			left--;
			return status(code);
		});
	}

	count(route?: Route): number {
		return route ? this.calls.filter((call) => call.route === route).length : this.calls.length;
	}

	posts(): Call[] {
		return this.calls.filter((call) => call.route === 'post');
	}

	edits(): Call[] {
		return this.calls.filter((call) => call.route === 'edit');
	}

	async handle(method: string, url: URL, body: unknown): Promise<Response> {
		const route = routeOf(method, url.pathname);
		const call: Call = { route, method, url, body };
		this.calls.push(call);

		for (const override of this.overrides.get(route) ?? []) {
			const res = await override(call);
			if (res) return res;
		}
		return this.respond(call);
	}

	membersPage(members: StubMember[], url: URL): Response {
		const after = BigInt(url.searchParams.get('after') ?? '0');
		const limit = Number(url.searchParams.get('limit') ?? '1');
		const page = [...members]
			.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
			.filter((member) => BigInt(member.id) > after)
			.slice(0, limit);
		return json(page.map(toDiscordMember));
	}

	private respond(call: Call): Response {
		switch (call.route) {
			case 'listMembers':
				return this.membersPage(this.members, call.url);
			case 'getMember': {
				const id = call.url.pathname.split('/').pop();
				const member = this.members.find((m) => m.id === id);
				return member ? json(toDiscordMember(member)) : status(404, { message: 'Unknown Member' });
			}
			case 'roles':
				return json(this.roles);
			case 'channels':
				return json([{ id: CHANNEL_ID, name: 'general', type: 0, position: 0, parent_id: null }]);
			case 'guild':
				return json({ id: GUILD_ID, name: 'test guild', icon: null, owner_id: this.ownerId });
			case 'post': {
				const channelId = call.url.pathname.split('/')[4];
				return json({
					id: `9${String(++this.messageSeq).padStart(17, '0')}`,
					channel_id: channelId
				});
			}
			case 'edit': {
				const [, , , , channelId, , messageId] = call.url.pathname.split('/');
				return json({ id: messageId, channel_id: channelId });
			}
		}
	}
}

export const discord = new DiscordStub();

/** Replaces fetch for the whole run: nothing may leave the process, Discord or not. */
export function installDiscordStub() {
	const stub = async (input: string | URL | Request, init?: RequestInit) => {
		const request = input instanceof Request ? input : null;
		const url = new URL(request ? request.url : input.toString());
		if (url.hostname !== 'discord.com') throw new Error(`unexpected fetch to ${url.origin}`);
		const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
		const raw = init?.body;
		const body = typeof raw === 'string' ? JSON.parse(raw) : undefined;
		return discord.handle(method, url, body);
	};
	globalThis.fetch = Object.assign(stub, { preconnect: () => {} }) as typeof fetch;
}
