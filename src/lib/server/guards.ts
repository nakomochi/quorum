import { error, redirect } from '@sveltejs/kit';
import type { SessionUser } from './auth';
import type { Form, GuildMember } from './db/schema';
import { activeMember, canSubmit, loadForm } from './forms';
import { reconcileMember, type Reconciled } from './guild-sync';
import { isGuildAdmin, looksLikeGuildAdmin } from './permissions';

const DISCORD_UNAVAILABLE =
	'Discord に接続できないため、今は操作できません。時間をおいてもう一度お試しください。';

/**
 * Memoized per request: actions run before, and independently of, the layout load, so both guard
 * the same request — and each isGuildAdmin costs three Discord calls.
 */
const adminChecks = new WeakMap<App.Locals, Promise<boolean>>();

/**
 * An unreachable Discord refuses with 503, as the creator's live check does. isGuildAdmin asks
 * nothing but Discord, so a database fault cannot be caught here and stays a 500.
 */
async function guildAdminCheck(locals: App.Locals, user: SessionUser): Promise<boolean> {
	let check = adminChecks.get(locals);
	if (!check) {
		check = isGuildAdmin(user.discordId);
		adminChecks.set(locals, check);
	}
	try {
		return await check;
	} catch (cause) {
		console.error('[guards] live admin check failed', cause);
		error(503, DISCORD_UNAVAILABLE);
	}
}

/**
 * Same per-request memo as adminChecks: a gate and a write check, or an action and the load after
 * it, share one lookup.
 */
const reconciles = new WeakMap<App.Locals, Promise<Reconciled>>();

function reconcileOnce(
	locals: App.Locals,
	discordId: string,
	mirrored: GuildMember | null
): Promise<Reconciled> {
	let reconcile = reconciles.get(locals);
	if (!reconcile) {
		reconcile = reconcileMember(discordId, mirrored);
		reconciles.set(locals, reconcile);
	}
	return reconcile;
}

/**
 * For reads. The mirrored row when it passes `accept`. Otherwise Discord is asked once before
 * refusing, and a disagreement is repaired by a full sync and read back, so a stale mirror does not
 * lock out someone who just joined or gained a role. Null for a non-member.
 */
export async function gateMember(
	locals: App.Locals,
	accept: (member: GuildMember) => boolean = () => true
): Promise<GuildMember | null> {
	const user = locals.user;
	if (!user) return null;

	const mirrored = await activeMember(user.discordId);
	if (mirrored && accept(mirrored)) return mirrored;

	try {
		const { synced } = await reconcileOnce(locals, user.discordId, mirrored);
		if (!synced) return mirrored;
	} catch (cause) {
		// The refusal stands: a read may be judged by the mirror.
		console.error('[guards] member lookup before a refusal failed', cause);
		return mirrored;
	}
	return activeMember(user.discordId);
}

export type LiveMembership =
	| { status: 'member'; roleIds: string[] }
	| { status: 'absent' }
	| { status: 'unavailable' };

/**
 * For writes, which a departure or a removed role must stop at once: Discord is asked every time
 * and its answer decides, never the mirror's. A disagreement with the mirror is repaired by a full
 * sync. 'unavailable' when Discord could not be asked, and the write must then be refused.
 */
export async function confirmMember(locals: App.Locals): Promise<LiveMembership> {
	const user = locals.user;
	if (!user) return { status: 'absent' };

	// Outside the try: a database fault must not pass for a Discord outage.
	const mirrored = await activeMember(user.discordId);
	try {
		const { live } = await reconcileOnce(locals, user.discordId, mirrored);
		return live ? { status: 'member', roleIds: live.roles } : { status: 'absent' };
	} catch (cause) {
		console.error('[guards] live member check failed', cause);
		return { status: 'unavailable' };
	}
}

/** Anonymous visitors go to the top page, which is where the login button lives. */
export function requireUser(locals: App.Locals): SessionUser {
	if (!locals.user) redirect(303, '/');
	return locals.user;
}

/**
 * Live only, never screened by the mirror like canManageForm: a newly promoted admin has to reach
 * the admin page's manual sync to bring the mirror up to date.
 */
export async function requireAdmin(locals: App.Locals): Promise<SessionUser> {
	const user = requireUser(locals);
	if (!(await guildAdminCheck(locals, user))) error(403, '管理者のみが利用できます');
	return user;
}

/**
 * Whoever may open a form's answer page, judged by the mirror like any read. Also guards the
 * answer drafts: they affect nobody but their owner, so a write there need not ask Discord.
 */
export async function requireSubmitter(
	locals: App.Locals,
	target: Pick<Form, 'submitScope' | 'targetRoleId'>
): Promise<GuildMember> {
	const member = await gateMember(locals, (m) => canSubmit(target, m));
	if (!member) error(403, 'このサーバーのメンバーではありません');
	if (!canSubmit(target, member)) error(403, 'このフォームの対象ではありません');
	return member;
}

export async function requireMember(
	locals: App.Locals
): Promise<{ user: SessionUser; member: GuildMember }> {
	const user = requireUser(locals);

	const member = await gateMember(locals);
	if (!member) error(403, 'このサーバーのメンバーではありません');

	return { user, member };
}

/** 'view' for a load, 'act' for an action that changes the form or posts to Discord. */
export type ManageAccess = 'view' | 'act';

/**
 * A form is managed by its creator or by a guild admin, either way only while in the guild. To
 * view, a creator present in the mirror costs no Discord call; to act, the creator's membership is
 * confirmed live. Wherever Discord is asked, an unreachable Discord refuses with 503.
 *
 * The admin branch is screened by the mirror first: the results page can be open to the whole
 * guild, and the live check is three calls, one of them the 5/s getGuildMember. The mirror is only
 * trusted to refuse; a grant is always confirmed live.
 */
export async function canManageForm(
	locals: App.Locals,
	target: Pick<Form, 'createdBy'>,
	access: ManageAccess
): Promise<boolean> {
	const user = locals.user;
	if (!user) return false;
	if (target.createdBy === user.id) {
		if (access === 'view') return (await gateMember(locals)) !== null;

		const live = await confirmMember(locals);
		if (live.status === 'unavailable') error(503, DISCORD_UNAVAILABLE);
		return live.status === 'member';
	}

	const mirrored = await activeMember(user.discordId);
	if (!(await looksLikeGuildAdmin(user.discordId, mirrored?.roleIds ?? []))) return false;
	return guildAdminCheck(locals, user);
}

export const FORM_NOT_FOUND = 'フォームが見つかりません';

export async function requireForm(formId: string): Promise<Form> {
	const target = await loadForm(formId);
	if (!target) error(404, FORM_NOT_FOUND);
	return target;
}

/** 404 for a missing form, then 403 for anyone who may not manage it. */
export async function requireFormManager(
	locals: App.Locals,
	formId: string,
	access: ManageAccess
): Promise<{ user: SessionUser; target: Form }> {
	const user = requireUser(locals);

	const target = await requireForm(formId);
	if (!(await canManageForm(locals, target, access))) {
		error(403, 'このフォームを操作する権限がありません');
	}

	return { user, target };
}
