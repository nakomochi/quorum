import { fail } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { form } from '$lib/server/db/schema';
import { isClosed, responseCounter } from '$lib/server/forms';
import { requireAdmin } from '$lib/server/guards';
import { listGuildRoles } from '$lib/server/discord';
import { lastSyncedAt, syncAllMembers } from '$lib/server/guild-sync';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	await requireAdmin(locals);

	const [rows, count, roles, syncedAt] = await Promise.all([
		db
			.select({
				id: form.id,
				title: form.title,
				targetRoleId: form.targetRoleId,
				submitScope: form.submitScope,
				deadline: form.deadline,
				closesAt: form.closesAt,
				closedAt: form.closedAt,
				finalTargetIds: form.finalTargetIds,
				finalNonSubmitters: form.finalNonSubmitters
			})
			.from(form)
			.orderBy(desc(form.createdAt)),
		responseCounter(),
		listGuildRoles(),
		lastSyncedAt()
	]);

	const roleNames = new Map(roles.map((role) => [role.id, role.name]));

	return {
		syncedAt,
		// Mapped field by field: the frozen lists are only needed for counting.
		forms: rows.map((row) => ({
			id: row.id,
			title: row.title,
			targetRoleId: row.targetRoleId,
			submitScope: row.submitScope,
			deadline: row.deadline,
			closesAt: row.closesAt,
			closedAt: row.closedAt,
			roleName: roleNames.get(row.targetRoleId) ?? '（削除されたロール）',
			closed: isClosed(row),
			...count(row)
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
