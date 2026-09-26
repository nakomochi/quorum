import { error, redirect } from '@sveltejs/kit';
import type { SessionUser } from './auth';
import type { Form, GuildMember } from './db/schema';
import { activeMember } from './forms';
import { reconcileMember } from './guild-sync';
import { isGuildAdmin } from './permissions';

/**
 * Memoized per request: actions run before, and independently of, the layout load, so both guard
 * the same request — and each isGuildAdmin costs three Discord calls.
 */
const adminChecks = new WeakMap<App.Locals, Promise<boolean>>();

function guildAdminCheck(locals: App.Locals, user: SessionUser): Promise<boolean> {
	let check = adminChecks.get(locals);
	if (!check) {
		check = isGuildAdmin(user.discordId);
		adminChecks.set(locals, check);
	}
	return check;
}

/** Same per-request memo as adminChecks: an action and the load after it share one lookup. */
const reconciles = new WeakMap<App.Locals, Promise<boolean>>();

function reconcileOnce(
	locals: App.Locals,
	discordId: string,
	mirrored: GuildMember | null
): Promise<boolean> {
	let reconcile = reconciles.get(locals);
	if (!reconcile) {
		reconcile = reconcileMember(discordId, mirrored);
		reconciles.set(locals, reconcile);
	}
	return reconcile;
}

/**
 * The mirrored row when it passes `accept`. Otherwise Discord is asked once before refusing, and
 * a disagreement is repaired by a full sync and read back, so a stale mirror does not lock out
 * someone who just joined or gained a role. Null for a non-member.
 */
export async function gateMember(
	locals: App.Locals,
	accept: (member: GuildMember) => boolean = () => true
): Promise<GuildMember | null> {
	const user = locals.user;
	if (!user) return null;

	const mirrored = await activeMember(user.discordId);
	if (mirrored && accept(mirrored)) return mirrored;

	if (!(await reconcileOnce(locals, user.discordId, mirrored))) return mirrored;
	return activeMember(user.discordId);
}

/** For a refusal that came from somewhere other than gateMember. True when the mirror was re-synced. */
export async function recheckMember(locals: App.Locals): Promise<boolean> {
	const user = locals.user;
	if (!user) return false;
	return reconcileOnce(locals, user.discordId, await activeMember(user.discordId));
}

/** Anonymous visitors go to the top page, which is where the login button lives. */
export function requireUser(locals: App.Locals): SessionUser {
	if (!locals.user) redirect(303, '/');
	return locals.user;
}

export async function requireAdmin(locals: App.Locals): Promise<SessionUser> {
	const user = requireUser(locals);
	if (!(await guildAdminCheck(locals, user))) error(403, '管理者のみが利用できます');
	return user;
}

export async function requireMember(
	locals: App.Locals
): Promise<{ user: SessionUser; member: GuildMember }> {
	const user = requireUser(locals);

	const member = await gateMember(locals);
	if (!member) error(403, 'このサーバーのメンバーではありません');

	return { user, member };
}

/**
 * A form is managed by its creator or by a guild admin. The creator branch short-circuits so the
 * common case costs no Discord call; the admin branch reads live, never the mirror.
 */
export async function canManageForm(
	locals: App.Locals,
	target: Pick<Form, 'createdBy'>
): Promise<boolean> {
	const user = locals.user;
	if (!user) return false;
	if (target.createdBy === user.id) return true;
	return guildAdminCheck(locals, user);
}
