import { error, type RequestEvent } from '@sveltejs/kit';
import type { SessionUser } from './auth';
import { requireMember } from './guards';
import { MAX_DRAFT_BYTES } from '../form-draft';

export const DRAFT_NOT_FOUND = '下書きが見つかりません';

const TOO_LARGE = '下書きが大きすぎるため保存できません';

/**
 * SvelteKit's CSRF check covers form content types only, and these endpoints take JSON, so a
 * request from another origin is refused here.
 */
export function requireSameOrigin(event: Pick<RequestEvent, 'request' | 'url'>) {
	if (event.request.headers.get('origin') !== event.url.origin) {
		error(403, '別のサイトからの保存は受け付けません');
	}
}

/**
 * Judged by the mirror, even for a write: a draft affects nobody but its author, so a member who
 * has just left can do no harm by saving one. 401 rather than the pages' redirect, for fetch.
 */
export async function requireDraftAuthor(locals: App.Locals): Promise<SessionUser> {
	if (!locals.user) error(401, 'ログインしてください');
	return (await requireMember(locals)).user;
}

/** Null once more than `maxBytes` has arrived, without reading the rest. */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
	if (!request.body) return '';
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The body's content is not validated, since a draft may be incomplete. It only has to be JSON
 * within the size limit, with an object for `payload`.
 */
export async function readDraftBody(
	request: Request
): Promise<{ payload: Record<string, unknown>; version: unknown }> {
	if (Number(request.headers.get('content-length')) > MAX_DRAFT_BYTES) error(413, TOO_LARGE);

	const raw = await readCapped(request, MAX_DRAFT_BYTES);
	if (raw === null) error(413, TOO_LARGE);

	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		body = undefined;
	}
	if (!isRecord(body) || !isRecord(body.payload)) error(400, '下書きのデータを読み取れませんでした');

	return { payload: body.payload, version: body.version };
}
