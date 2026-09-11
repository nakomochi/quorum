import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The fixtures ship in the production bundle; the route must not be reachable there.
export const load: PageServerLoad = () => {
	if (!dev) error(404);
};
