import { error, fail } from '@sveltejs/kit';
import {
	activeMember,
	canViewResults,
	closeForm,
	loadForm,
	loadQuestions,
	loadResults,
	reopenForm,
	RosterRefreshError,
	tallyChoices
} from '$lib/server/forms';
import { canManageForm, requireUser } from '$lib/server/guards';
import type { Actions, PageServerLoad } from './$types';

const NOT_FOUND = 'フォームが見つかりません';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireUser(locals);

	const target = await loadForm(params.id);
	if (!target) error(404, NOT_FOUND);

	const manage = await canManageForm(locals, target);
	// Managers keep access even after leaving the guild; everyone else needs current membership.
	if (!manage && !(await activeMember(user.discordId))) {
		error(403, 'このサーバーのメンバーではありません');
	}
	if (!canViewResults(target, manage)) error(403, 'この結果はまだ公開されていません');

	const questions = await loadQuestions(params.id);
	const results = await loadResults(target);

	return {
		form: {
			id: target.id,
			title: target.title,
			description: target.description,
			visibility: target.visibility,
			deadline: target.deadline,
			closesAt: target.closesAt,
			closedAt: target.closedAt
		},
		manage,
		questions: questions.map((q) => ({
			id: q.id,
			label: q.label,
			type: q.type,
			options: q.options
		})),
		tallies: tallyChoices(questions, [...results.submitted, ...results.outsiders]),
		...results
	};
};

/** Actions run before the load, so each repeats the manage check itself. */
async function requireManager(locals: App.Locals, formId: string) {
	requireUser(locals);

	const target = await loadForm(formId);
	if (!target) error(404, NOT_FOUND);
	if (!(await canManageForm(locals, target))) error(403, 'このフォームを操作する権限がありません');

	return target;
}

export const actions: Actions = {
	close: async ({ locals, params }) => {
		await requireManager(locals, params.id);

		let result;
		try {
			result = await closeForm(params.id);
		} catch (err) {
			// Only the roster refresh is reported as a Discord problem; a database fault must not be
			// disguised as one.
			if (!(err instanceof RosterRefreshError)) throw err;
			return fail(502, {
				message:
					'Discord からメンバー一覧を取得できませんでした。古い情報で確定させないため、クローズしていません。'
			});
		}

		if (!result.ok) {
			return result.reason === 'not_found'
				? fail(404, { message: NOT_FOUND })
				: fail(409, { message: 'このフォームはすでにクローズされています' });
		}

		return { closed: result.frozen };
	},

	reopen: async ({ locals, params }) => {
		await requireManager(locals, params.id);

		if (!(await reopenForm(params.id))) {
			return fail(409, { message: 'このフォームはクローズされていません' });
		}

		return { reopened: true };
	}
};
