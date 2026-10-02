import { error, fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { deleteDraft, listDrafts } from '$lib/server/drafts';
import { listPendingForms, pageCreatedForms, pageSubmittedForms } from '$lib/server/form-lists';
import { gateMember, requireMember } from '$lib/server/guards';
import { FIRST_PAGE } from '$lib/server/keyset';
import type { Actions, PageServerLoad } from './$types';

/** The newest of the submitted and the created forms; the rest are on their own pages. */
const PREVIEW = 5;

const ANONYMOUS = {
	member: false,
	pending: [],
	submitted: [],
	submittedTotal: 0,
	created: [],
	createdTotal: 0,
	drafts: []
};

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

	const [pending, submitted, created, drafts] = await Promise.all([
		listPendingForms(member, user.id),
		pageSubmittedForms(member, user.id, FIRST_PAGE, PREVIEW),
		pageCreatedForms(user.id, FIRST_PAGE, PREVIEW),
		listDrafts(user.id)
	]);

	// Totals for the links to the rest; the cursors are not drawn here.
	return {
		member: true,
		pending,
		submitted: submitted.rows,
		submittedTotal: submitted.total,
		created: created.rows,
		createdTotal: created.total,
		drafts
	};
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
