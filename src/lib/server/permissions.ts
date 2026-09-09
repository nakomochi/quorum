import { getGuild, getGuildMember, listGuildRoles, type DiscordRole } from './discord';

const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

export const ADMIN_PERMISSIONS = ADMINISTRATOR | MANAGE_GUILD;

/**
 * Union of the permissions granted by the given roles.
 *
 * The @everyone role is added explicitly: its id equals the guild id, it applies to every
 * member, and Discord omits it from `member.roles`.
 */
export function rolePermissions(
	roleIds: string[],
	roles: DiscordRole[],
	guildId: string
): bigint {
	const held = new Set([...roleIds, guildId]);
	let permissions = 0n;
	for (const role of roles) {
		// Bitfields exceed Number.MAX_SAFE_INTEGER, so they arrive as decimal strings.
		if (held.has(role.id)) permissions |= BigInt(role.permissions);
	}
	return permissions;
}

export function hasAdminPermissions(
	roleIds: string[],
	roles: DiscordRole[],
	guildId: string
): boolean {
	return (rolePermissions(roleIds, roles, guildId) & ADMIN_PERMISSIONS) !== 0n;
}

/**
 * Admin means guild owner, or holder of a role with ADMINISTRATOR or MANAGE_GUILD.
 * Read live from Discord rather than from the mirror: a revoked role must take effect at once.
 */
export async function isGuildAdmin(discordId: string): Promise<boolean> {
	const guild = await getGuild();
	if (guild.owner_id === discordId) return true;

	const member = await getGuildMember(discordId);
	if (!member) return false;

	const roles = await listGuildRoles();
	return hasAdminPermissions(member.roles, roles, guild.id);
}

type GuildRoster = { ownerId: string; guildId: string; roles: DiscordRole[] };

let roster: Promise<GuildRoster> | null = null;
let lastKnown: GuildRoster | null = null;

/** No TTL by design: a silent one is the staleness this app avoids. Cleared by the admin sync. */
export function invalidateGuildRoster(): void {
	roster = null;
}

function guildRoster(): Promise<GuildRoster> {
	if (roster) return roster;

	const value = (async () => {
		const [guild, roles] = await Promise.all([getGuild(), listGuildRoles()]);
		return { ownerId: guild.owner_id, guildId: guild.id, roles };
	})();

	roster = value;
	value.then(
		(resolved) => {
			lastKnown = resolved;
		},
		() => {
			// A failed fetch must not stick, or one outage blanks the button until a manual sync.
			if (roster === value) roster = null;
		}
	);

	return value;
}

/**
 * Display-only: decides whether the admin link is drawn. roleIds come from the mirror, which has
 * no TTL, so a revoked role can linger here until the next member sync. Never use this to
 * authorize; requireAdmin reads live and stays fail-closed.
 *
 * Returns false rather than throwing when Discord is unreachable: a dropped link must not take
 * the whole page down.
 */
export async function looksLikeGuildAdmin(discordId: string, roleIds: string[]): Promise<boolean> {
	let snapshot: GuildRoster;
	try {
		snapshot = await guildRoster();
	} catch {
		if (!lastKnown) return false;
		snapshot = lastKnown;
	}

	if (snapshot.ownerId === discordId) return true;
	return hasAdminPermissions(roleIds, snapshot.roles, snapshot.guildId);
}
