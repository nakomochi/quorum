import { fail } from '@sveltejs/kit';
import type { RevisionAnswers } from '$lib/forms';
import { draftDiffers, readResponseDraft, type DraftQuestion } from '$lib/response-draft';
import {
	canViewResults,
	collectAnswerInputs,
	FormInputError,
	isClosed,
	loadOwnResponse,
	loadQuestions,
	loadRevisions,
	submitResponse,
	type SubmitFailure
} from '$lib/server/forms';
import { confirmMember, requireForm, requireSubmitter, requireUser } from '$lib/server/guards';
import { looksLikeGuildAdmin } from '$lib/server/permissions';
import { loadResponseDraft } from '$lib/server/response-drafts';
import type { Actions, PageServerLoad } from './$types';

const STATUS: Record<SubmitFailure | 'not_member', number> = {
	not_found: 404,
	not_member: 403,
	forbidden: 403,
	closed: 409,
	already_submitted: 409
};

/**
 * The draft as the page may use it, or null when there is nothing it could do with one. A draft
 * that matches the submitted answers is no unsent change, but its version is still returned: the
 * page's next save has to name it.
 */
async function ownDraft(
	formId: string,
	userId: string,
	questions: DraftQuestion[],
	submitted: RevisionAnswers
) {
	const row = await loadResponseDraft(formId, userId);
	if (!row) return null;
	const answers = readResponseDraft(row.answers, questions);
	return {
		version: row.version,
		updatedAt: row.updatedAt,
		answers: draftDiffers(answers, submitted) ? answers : null
	};
}

/** Only the questions the page shows: a removed question's answer is not sent. */
function liveAnswers(answers: RevisionAnswers, questions: { id: number }[]): RevisionAnswers {
	return Object.fromEntries(
		questions.flatMap((q) => {
			const value = answers[String(q.id)];
			return value ? [[String(q.id), value] as const] : [];
		})
	);
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireUser(locals);

	const target = await requireForm(params.id);
	const member = await requireSubmitter(locals, target);

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
	const editable = !closed && (own === null || target.allowEdit);

	const submitted = liveAnswers(
		Object.fromEntries((own?.answers ?? []).map((row) => [String(row.questionId), row.value])),
		questions
	);

	// Both are the viewer's own: the draft is keyed by the session's user, and the revisions by
	// the response loadOwnResponse found for that user. A single revision is the submitted answer.
	const [draft, revisions] = await Promise.all([
		editable ? ownDraft(params.id, user.id, questions, submitted) : null,
		own ? loadRevisions(own.response.id) : []
	]);

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
		editable,
		submittedAt: own?.response.submittedAt ?? null,
		updatedAt: own?.response.updatedAt ?? null,
		answers: submitted,
		draft,
		history:
			revisions.length > 1
				? revisions.map((revision) => ({
						number: revision.number,
						createdAt: revision.createdAt,
						answers: liveAnswers(revision.answers, questions)
					}))
				: []
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
