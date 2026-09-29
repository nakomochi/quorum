import { json } from '@sveltejs/kit';
import { readDraftBody, requireDraftAuthor, requireSameOrigin } from '$lib/server/draft-api';
import { createDraft } from '$lib/server/drafts';
import type { RequestHandler } from './$types';

/** The editor's first save. Later saves go to /forms/drafts/[id] with the version they read. */
export const POST: RequestHandler = async (event) => {
	requireSameOrigin(event);
	const user = await requireDraftAuthor(event.locals);
	const { payload } = await readDraftBody(event.request);

	return json(await createDraft(user.id, payload), { status: 201 });
};
