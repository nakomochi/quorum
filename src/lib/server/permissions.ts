import { getGuild, getGuildMember, guildId, listGuildRoles, type DiscordRole } from './discord';
import { syncedGuildRoles } from './guild-sync';

const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

export const ADMIN_PERMISSIONS = ADMINISTRATOR | MANAGE_GUILD;

type RolePermissions = Pick<DiscordRole, 'id' | 'permissions'>;

/**
 * Union of the permissions granted by the given roles.
 *
 * The @everyone role is added explicitly: its id equals the guild id, it applies to every
 * member, and Discord omits it from `member.roles`.
 */
export function rolePermissions(
	roleIds: string[],
	roles: RolePermissions[],
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
	roles: RolePermissions[],
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

/**
 * Display-only: decides whether the admin link is drawn. Judged against the last full sync, so a
 * change in Discord shows here only after the next one. Never use this to authorize;
 * requireAdmin reads live and stays fail-closed.
 */
export async function looksLikeGuildAdmin(discordId: string, roleIds: string[]): Promise<boolean> {
	const snapshot = await syncedGuildRoles();
	if (!snapshot) return false;
	if (snapshot.ownerId === discordId) return true;
	return hasAdminPermissions(roleIds, snapshot.roles, guildId());
}
