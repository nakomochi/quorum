import { error, redirect } from '@sveltejs/kit';
import type { SessionUser } from './auth';
import type { Form, GuildMember } from './db/schema';
import { activeMember } from './forms';
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

	const member = await activeMember(user.discordId);
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
