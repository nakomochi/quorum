import { resultTable } from '$lib/results-table';
import { attachmentDisposition, toCsv } from '$lib/server/csv';
import { loadQuestions, loadResults } from '$lib/server/forms';
import { requireResultsViewer } from '$lib/server/guards';
import type { RequestHandler } from './$types';

/** The results page's responses, for whoever may open that page. Non-submitters are left out. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const { target } = await requireResultsViewer(locals, params.id);

	const [questions, results] = await Promise.all([loadQuestions(target.id), loadResults(target)]);
	const { header, rows } = resultTable(
		questions,
		results.submitted,
		results.targetCount === null ? null : results.outsiders
	);

	return new Response(toCsv([header, ...rows]), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': attachmentDisposition(target.title, 'responses', 'csv'),
			'cache-control': 'no-store'
		}
	});
};
