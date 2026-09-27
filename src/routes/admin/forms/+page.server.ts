import { fail } from '@sveltejs/kit';
import { count, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { form, response } from '$lib/server/db/schema';
import { isClosed } from '$lib/server/forms';
import { requireAdmin } from '$lib/server/guards';
import { listGuildRoles } from '$lib/server/discord';
import { lastSyncedAt, syncAllMembers } from '$lib/server/guild-sync';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	await requireAdmin(locals);

	const [rows, roles, syncedAt] = await Promise.all([
		db
			.select({
				id: form.id,
				title: form.title,
				targetRoleId: form.targetRoleId,
				submitScope: form.submitScope,
				deadline: form.deadline,
				closesAt: form.closesAt,
				closedAt: form.closedAt,
				structureLockedAt: form.structureLockedAt,
				responseCount: count(response.id)
			})
			.from(form)
			.leftJoin(response, eq(response.formId, form.id))
			.groupBy(form.id)
			.orderBy(desc(form.createdAt)),
		listGuildRoles(),
		lastSyncedAt()
	]);

	const roleNames = new Map(roles.map((role) => [role.id, role.name]));

	return {
		syncedAt,
		forms: rows.map((row) => ({
			...row,
			roleName: roleNames.get(row.targetRoleId) ?? '（削除されたロール）',
			closed: isClosed(row)
		}))
	};
};

export const actions: Actions = {
	// Actions run independently of the layout load, so the admin check is repeated here.
	sync: async ({ locals }) => {
		await requireAdmin(locals);

		try {
			const result = await syncAllMembers();
			return { present: result.present, markedLeft: result.markedLeft };
		} catch {
			// syncAllMembers throws on a Discord outage or an empty member list; neither should
			// take the management page down.
			return fail(502, { message: 'Discord からメンバー一覧を取得できませんでした' });
		}
	}
};
