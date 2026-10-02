import { fail } from '@sveltejs/kit';
import { formsPageRequest, pageAllForms } from '$lib/server/form-lists';
import { requireAdmin } from '$lib/server/guards';
import { listGuildRoles } from '$lib/server/discord';
import { lastSyncedAt, syncAllMembers } from '$lib/server/guild-sync';
import { PAGE_SIZE } from '$lib/server/keyset';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireAdmin(locals);

	const [page, roles, syncedAt] = await Promise.all([
		pageAllForms(formsPageRequest(url), PAGE_SIZE),
		listGuildRoles(),
		lastSyncedAt()
	]);

	const roleNames = new Map(roles.map((role) => [role.id, role.name]));

	return {
		syncedAt,
		total: page.total,
		older: page.older,
		newer: page.newer,
		// The role id is only needed for its name.
		forms: page.rows.map(({ targetRoleId, ...row }) => ({
			...row,
			// Null for a form without a role.
			roleName:
				targetRoleId === null ? null : (roleNames.get(targetRoleId) ?? '（削除されたロール）')
		}))
	};
};

export const actions: Actions = {
	// Actions run independently of the layout load, so the admin check is repeated here.
	sync: async ({ locals }) => {
		await requireAdmin(locals);

		try {
			const result = await syncAllMembers();
			return { notice: `${result.present}名を同期しました（退会 ${result.markedLeft}名）` };
		} catch {
			// syncAllMembers throws on a Discord outage or an empty member list; neither should
			// take the management page down.
			return fail(502, { message: 'Discord からメンバー一覧を取得できませんでした' });
		}
	}
};
