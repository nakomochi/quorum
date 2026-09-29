import { error, json } from '@sveltejs/kit';
import {
	DRAFT_NOT_FOUND,
	readDraftBody,
	requireDraftAuthor,
	requireSameOrigin
} from '$lib/server/draft-api';
import { deleteDraft, updateDraft } from '$lib/server/drafts';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async (event) => {
	requireSameOrigin(event);
	const user = await requireDraftAuthor(event.locals);
	const { payload, version } = await readDraftBody(event.request);
	if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
		error(400, '下書きの版が不正です');
	}

	const result = await updateDraft(event.params.id, user.id, version, payload);
	if (result.ok) return json({ version: result.version, updatedAt: result.updatedAt });
	if (result.reason === 'not_found') error(404, DRAFT_NOT_FOUND);
	return json({ reason: 'conflict' }, { status: 409 });
};

export const DELETE: RequestHandler = async (event) => {
	requireSameOrigin(event);
	const user = await requireDraftAuthor(event.locals);

	if (!(await deleteDraft(event.params.id, user.id))) error(404, DRAFT_NOT_FOUND);
	return new Response(null, { status: 204 });
};
