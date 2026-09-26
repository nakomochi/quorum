import { error, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { listFormsCreatedBy, listFormsForMember } from '$lib/server/forms';
import { gateMember } from '$lib/server/guards';
import { looksLikeGuildAdmin } from '$lib/server/permissions';
import type { Actions, PageServerLoad } from './$types';

const ANONYMOUS = { member: false, isAdmin: false, pending: [], submitted: [], created: [] };

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) return ANONYMOUS;

	const member = await gateMember(locals);
	if (!member) return ANONYMOUS;

	const [forms, created, isAdmin] = await Promise.all([
		listFormsForMember(member, user.id),
		listFormsCreatedBy(user.id),
		looksLikeGuildAdmin(user.discordId, member.roleIds)
	]);

	return { member: true, isAdmin, created, ...forms };
};

export const actions: Actions = {
	login: async ({ request }) => {
		// disableRedirect: we want the url back so SvelteKit issues the redirect itself.
		const result = await auth.api.signInSocial({
			body: { provider: 'discord', callbackURL: '/', disableRedirect: true },
			headers: request.headers
		});

		// `url` is absent on the id-token branch, which Discord never takes.
		if (!result.url) {
			error(500, 'Discord の認証 URL を取得できませんでした');
		}

		redirect(303, result.url);
	},

	logout: async ({ request }) => {
		await auth.api.signOut({ headers: request.headers });

		// Must redirect: locals still holds the destroyed session within this request.
		redirect(303, '/');
	}
};
