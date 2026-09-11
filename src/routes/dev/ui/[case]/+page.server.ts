import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import { isCaseId } from '$lib/dev/fixtures';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	if (!dev) error(404);
	if (!isCaseId(params.case)) error(404, `unknown case: ${params.case}`);

	return { case: params.case };
};
