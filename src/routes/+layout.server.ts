import { activeMember, memberDisplayName } from '$lib/server/forms';
import { looksLikeGuildAdmin } from '$lib/server/permissions';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) return { user: null, member: false, isAdmin: false };

	// The mirror only, never Discord: this runs for every page and only decides which links the
	// header draws. Each destination checks access again on its own.
	const mirrored = await activeMember(user.discordId);
	const isAdmin = mirrored ? await looksLikeGuildAdmin(user.discordId, mirrored.roleIds) : false;

	return {
		// Only what the header draws: the session user also carries the email and ids. The name is
		// the one the guild shows, falling back to the Discord account's for someone not mirrored.
		user: { name: mirrored ? memberDisplayName(mirrored) : user.name, image: user.image ?? null },
		member: mirrored !== null,
		isAdmin
	};
};
