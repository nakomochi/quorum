import { error, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { Actions } from './$types';

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
