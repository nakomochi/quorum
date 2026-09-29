import { error, type RequestEvent } from '@sveltejs/kit';
import type { SessionUser } from './auth';
import { requireMember } from './guards';
import { MAX_DRAFT_BYTES } from '../form-draft';
import { MAX_RESPONSE_DRAFT_BYTES } from '../response-draft';

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
 * A draft body: JSON within `maxBytes`, with an object under `field`. The object's content is
 * not validated, since a draft may be incomplete.
 */
async function readDraftObject(
	request: Request,
	maxBytes: number,
	field: string
): Promise<{ content: Record<string, unknown>; version: unknown }> {
	if (Number(request.headers.get('content-length')) > maxBytes) error(413, TOO_LARGE);

	const raw = await readCapped(request, maxBytes);
	if (raw === null) error(413, TOO_LARGE);

	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		body = undefined;
	}
	if (!isRecord(body) || !isRecord(body[field])) error(400, '下書きのデータを読み取れませんでした');

	return { content: body[field], version: body.version };
}

export async function readDraftBody(
	request: Request
): Promise<{ payload: Record<string, unknown>; version: unknown }> {
	const { content, version } = await readDraftObject(request, MAX_DRAFT_BYTES, 'payload');
	return { payload: content, version };
}

/** An answer draft's body. `version` is 0 for a draft that does not exist yet. */
export async function readResponseDraftBody(
	request: Request
): Promise<{ answers: Record<string, unknown>; version: number }> {
	const { content, version } = await readDraftObject(request, MAX_RESPONSE_DRAFT_BYTES, 'answers');
	if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
		error(400, '下書きの版が不正です');
	}
	return { answers: content, version };
}
