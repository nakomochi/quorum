import { requireAdmin } from '$lib/server/guards';
import type { LayoutServerLoad } from './$types';

/**
 * Guards navigation to /admin. Page loads run in parallel with this one and form actions run
 * before it, so both call requireAdmin themselves; the check is memoized per request.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	await requireAdmin(locals);
};
