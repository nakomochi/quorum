import { formsPageRequest, pageCreatedForms } from '$lib/server/form-lists';
import { requireMember } from '$lib/server/guards';
import { PAGE_SIZE } from '$lib/server/keyset';
import type { PageServerLoad } from './$types';

/** The top page's 作成した list in full, judged by the mirror like the top page. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const { user } = await requireMember(locals);

	const { rows, total, older, newer } = await pageCreatedForms(
		user.id,
		formsPageRequest(url),
		PAGE_SIZE
	);
	return { rows, total, older, newer };
};
