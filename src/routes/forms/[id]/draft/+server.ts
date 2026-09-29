import { error, json, type RequestEvent } from '@sveltejs/kit';
import type { SessionUser } from '$lib/server/auth';
import { readResponseDraftBody, requireSameOrigin } from '$lib/server/draft-api';
import { FORM_NOT_FOUND, requireForm, requireSubmitter } from '$lib/server/guards';
import { deleteResponseDraft, saveResponseDraft } from '$lib/server/response-drafts';
import type { RequestHandler } from './$types';

/**
 * The answer page's draft, keyed by the form and the session's user: there is no id to name
 * anyone else's. Only those who may open the answer page reach it, judged by the mirror.
 */
async function requireDraftOwner(event: RequestEvent<{ id: string }>): Promise<SessionUser> {
	requireSameOrigin(event);
	const user = event.locals.user;
	if (!user) error(401, 'ログインしてください');
	const target = await requireForm(event.params.id);
	await requireSubmitter(event.locals, target);
	return user;
}

export const PUT: RequestHandler = async (event) => {
	const user = await requireDraftOwner(event);
	const { answers, version } = await readResponseDraftBody(event.request);

	const result = await saveResponseDraft(event.params.id, user.id, version, answers);
	if (result.ok) return json({ version: result.version, updatedAt: result.updatedAt });
	if (result.reason === 'not_found') error(404, FORM_NOT_FOUND);
	return json({ reason: result.reason }, { status: 409 });
};

export const DELETE: RequestHandler = async (event) => {
	const user = await requireDraftOwner(event);

	await deleteResponseDraft(event.params.id, user.id);
	return new Response(null, { status: 204 });
};
