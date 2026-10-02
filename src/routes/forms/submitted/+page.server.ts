import { pageSubmittedForms, submittedPageRequest } from '$lib/server/form-lists';
import { requireMember } from '$lib/server/guards';
import { PAGE_SIZE } from '$lib/server/keyset';
import type { PageServerLoad } from './$types';

/** The top page's 提出済み list in full, judged by the mirror like the top page. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const { user, member } = await requireMember(locals);

	const { rows, total, older, newer } = await pageSubmittedForms(
		member,
		user.id,
		submittedPageRequest(url),
		PAGE_SIZE
	);
	return { rows, total, older, newer };
};
