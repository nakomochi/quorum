import { error, fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { deleteDraft, listDrafts } from '$lib/server/drafts';
import { listFormsCreatedBy, listFormsForMember } from '$lib/server/forms';
import { gateMember, requireMember } from '$lib/server/guards';
import type { Actions, PageServerLoad } from './$types';

const ANONYMOUS = { member: false, pending: [], submitted: [], created: [], drafts: [] };

/**
 * The header's flags come from the root layout. `member` is decided again here, by gateMember
 * rather than the mirror alone: it lets someone who just joined see their forms before the next
 * sync, and the lists below need the member's roles anyway.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) return ANONYMOUS;

	const member = await gateMember(locals);
	if (!member) return ANONYMOUS;

	const [forms, created, drafts] = await Promise.all([
		listFormsForMember(member, user.id),
		listFormsCreatedBy(user.id),
		listDrafts(user.id)
	]);

	return { member: true, created, drafts, ...forms };
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

	// Judged by the mirror like saving a draft: it affects nobody but its author.
	discardDraft: async ({ locals, request }) => {
		const { user } = await requireMember(locals);

		const id = (await request.formData()).get('id');
		if (typeof id !== 'string' || !(await deleteDraft(id, user.id))) {
			return fail(404, { message: '下書きが見つかりません。すでに破棄されたか、作成済みです' });
		}

		return { discarded: true };
	},

	// Posted to from the shared header on every page.
	logout: async ({ request }) => {
		await auth.api.signOut({ headers: request.headers });

		// Must redirect: locals still holds the destroyed session within this request.
		redirect(303, '/');
	}
};
