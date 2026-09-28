import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const user = locals.user;
	// Only what the pages draw: the session user also carries the email and ids.
	return { user: user ? { name: user.name, image: user.image ?? null } : null };
};
