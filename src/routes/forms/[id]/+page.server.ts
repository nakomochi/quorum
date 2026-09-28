import { error, fail } from '@sveltejs/kit';
import {
	canSubmit,
	canViewResults,
	collectAnswerInputs,
	FormInputError,
	isClosed,
	loadOwnResponse,
	loadQuestions,
	submitResponse,
	type SubmitFailure
} from '$lib/server/forms';
import { confirmMember, gateMember, requireForm, requireUser } from '$lib/server/guards';
import { looksLikeGuildAdmin } from '$lib/server/permissions';
import type { Actions, PageServerLoad } from './$types';

const STATUS: Record<SubmitFailure | 'not_member', number> = {
	not_found: 404,
	not_member: 403,
	forbidden: 403,
	closed: 409,
	already_submitted: 409
};

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireUser(locals);

	const target = await requireForm(params.id);

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

		const live = await confirmMember(locals);
		// Not a changed situation but a passing fault: the typed answers stay for another try.
		if (live.status === 'unavailable') {
			return fail(503, {
				message:
					'Discord に接続できないため、今は送信できません。時間をおいてもう一度送信してください。'
			});
		}

		// Every refusal means the page is out of date. The client reloads it, and the reload is
		// what explains the refusal, so only the reason goes back.
		if (live.status === 'absent') return fail(STATUS.not_member, { reason: 'not_member' });

		const questions = await loadQuestions(params.id);
		const data = await request.formData();
		const inputs = collectAnswerInputs(data, questions);

		try {
			const result = await submitResponse(
				params.id,
				{ id: user.id, discordId: user.discordId },
				{ roleIds: live.roleIds },
				inputs
			);
			if (!result.ok) return fail(STATUS[result.reason], { reason: result.reason });
			return { created: result.created };
		} catch (err) {
			if (err instanceof FormInputError) return fail(400, { message: err.message });
			throw err;
		}
	}
};
