import { error, fail } from '@sveltejs/kit';
import {
	canSubmit,
	canViewResults,
	collectAnswerInputs,
	FormInputError,
	isClosed,
	loadForm,
	loadOwnResponse,
	loadQuestions,
	submitResponse,
	type SubmitFailure
} from '$lib/server/forms';
import { gateMember, recheckMember, requireUser } from '$lib/server/guards';
import { looksLikeGuildAdmin } from '$lib/server/permissions';
import type { Actions, PageServerLoad } from './$types';

const STATUS: Record<SubmitFailure, number> = {
	not_found: 404,
	not_member: 403,
	forbidden: 403,
	closed: 409,
	already_submitted: 409
};

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireUser(locals);

	const target = await loadForm(params.id);
	if (!target) error(404, 'フォームが見つかりません');

	const member = await gateMember(locals, (m) => canSubmit(target, m));
	if (!member) error(403, 'このサーバーのメンバーではありません');
	if (!canSubmit(target, member)) error(403, 'このフォームの対象ではありません');

	// Display-only, and only to decide whether the results link is drawn. A reminder puts the whole
	// target roster on this page at once, so the live admin check (three calls, one of them the
	// 5/s getGuildMember) cannot go here. The results page re-authorizes live, so a link left over
	// from a revoked role fails when it is followed.
	const [questions, own, manage] = await Promise.all([
		loadQuestions(params.id),
		loadOwnResponse(params.id, user.id),
		target.createdBy === user.id || looksLikeGuildAdmin(user.discordId, member.roleIds)
	]);

	const closed = isClosed(target);

	return {
		resultsVisible: canViewResults(target, manage),
		form: {
			id: target.id,
			title: target.title,
			description: target.description,
			deadline: target.deadline,
			closesAt: target.closesAt
		},
		questions: questions.map((q) => ({
			id: q.id,
			type: q.type,
			label: q.label,
			helpText: q.helpText,
			required: q.required,
			options: q.options,
			allowOther: q.allowOther
		})),
		closed,
		editable: !closed && (own === null || target.allowEdit),
		submittedAt: own?.response.submittedAt ?? null,
		updatedAt: own?.response.updatedAt ?? null,
		answers: Object.fromEntries(
			(own?.answers ?? []).map((row) => [row.questionId, row.value] as const)
		)
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		const user = requireUser(locals);

		const questions = await loadQuestions(params.id);
		const data = await request.formData();

		const inputs = collectAnswerInputs(data, questions);
		const submit = () =>
			submitResponse(params.id, { id: user.id, discordId: user.discordId }, inputs);

		try {
			let result = await submit();

			// submitResponse only reads the mirror, keeping Discord I/O away from its transaction,
			// so a stale refusal is checked here and the submission retried once after a re-sync.
			if (
				!result.ok &&
				(result.reason === 'not_member' || result.reason === 'forbidden') &&
				(await recheckMember(locals))
			) {
				result = await submit();
			}

			// Every refusal means the page is out of date. The client reloads it, and the reload is
			// what explains the refusal, so only the reason goes back.
			if (!result.ok) return fail(STATUS[result.reason], { reason: result.reason });
			return { created: result.created };
		} catch (err) {
			if (err instanceof FormInputError) return fail(400, { message: err.message });
			throw err;
		}
	}
};
