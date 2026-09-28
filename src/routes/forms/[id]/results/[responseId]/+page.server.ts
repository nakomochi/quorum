import { error } from '@sveltejs/kit';
import { loadQuestions, loadResponseHistory } from '$lib/server/forms';
import { requireFormManager } from '$lib/server/guards';
import type { PageServerLoad } from './$types';

const NOT_FOUND = '回答が見つかりません';

const MAX_INT4 = 2_147_483_647;

// Past int4 Postgres raises an error instead of finding nothing.
function parseResponseId(raw: string): number | null {
	if (!/^\d{1,10}$/.test(raw)) return null;
	const id = Number(raw);
	return id <= MAX_INT4 ? id : null;
}

// Managers only: the results page may be open to the whole guild, but it shows only the latest
// answers.
export const load: PageServerLoad = async ({ locals, params }) => {
	const { target } = await requireFormManager(locals, params.id, 'view');

	const responseId = parseResponseId(params.responseId);
	const history = responseId === null ? null : await loadResponseHistory(target.id, responseId);
	if (!history) error(404, NOT_FOUND);

	const questions = await loadQuestions(target.id);

	return {
		form: { id: target.id, title: target.title },
		response: {
			displayName: history.displayName,
			submittedAt: history.submittedAt,
			updatedAt: history.updatedAt
		},
		revisions: history.revisions,
		questions: questions.map((q) => ({ id: q.id, label: q.label, options: q.options }))
	};
};
