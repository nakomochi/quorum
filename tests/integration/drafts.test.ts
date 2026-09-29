import { describe, expect, test } from 'bun:test';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { form, formDraft, question } from '$lib/server/db/schema';
import { createForm } from '$lib/server/forms';
import { draftPayload, MAX_DRAFT_BYTES, readDraftPayload } from '$lib/form-draft';
import { utf8Bytes } from '$lib/forms';
import { actions as topActions } from '../../src/routes/+page.server';
import { POST } from '../../src/routes/forms/drafts/+server';
import { PUT } from '../../src/routes/forms/drafts/[id]/+server';
import { actions as newActions, load as newLoad } from '../../src/routes/forms/new/+page.server';
import { actions as resultsActions } from '../../src/routes/forms/[id]/results/+page.server';
import { ADMIN_ROLE, CHANNEL_ID, discord, OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	DEFAULT_QUESTIONS,
	makeForm,
	member,
	seedGuild,
	sessionLocals,
	snowflake,
	type TestUser
} from '../helpers/fixtures';

const ORIGIN = 'http://forms.test';

type Call = { status: number; body: Record<string, unknown> | null };

/** Runs a handler as SvelteKit would, turning a thrown error() into its status. */
async function call(
	handler: (event: never) => Promise<Response> | Response,
	options: {
		who: TestUser | null;
		method: 'POST' | 'PUT';
		id?: string;
		body?: unknown;
		raw?: string;
		headers?: Record<string, string>;
	}
): Promise<Call> {
	const path = options.id ? `/forms/drafts/${options.id}` : '/forms/drafts';
	const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
	const request = new Request(`${ORIGIN}${path}`, {
		method: options.method,
		headers: { origin: ORIGIN, 'content-type': 'application/json', ...options.headers },
		body
	});
	const event = {
		request,
		url: new URL(request.url),
		params: options.id ? { id: options.id } : {},
		locals: options.who ? sessionLocals(options.who) : ({} as App.Locals)
	};
	try {
		const response = await handler(event as never);
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : null };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, body: { message: e.body.message } };
		throw e;
	}
}

const payload = (title: string, extra: Record<string, string[]> = {}) =>
	draftPayload({ title: [title], ...extra }, false);

async function stored(id: string) {
	const [row] = await db.select().from(formDraft).where(eq(formDraft.id, id));
	return row ?? null;
}

async function setup() {
	const [author, other, admin] = await createUsers([1, 2, 3].map(snowflake));
	await seedGuild([
		member(author.discordId, [TARGET_ROLE]),
		member(other.discordId, [OTHER_ROLE]),
		member(admin.discordId, [ADMIN_ROLE])
	]);
	return { author, other, admin };
}

async function created(who: TestUser, title = '下書き') {
	const result = await call(POST, { who, method: 'POST', body: { payload: payload(title) } });
	expect(result.status).toBe(201);
	return result.body as { id: string; version: number; updatedAt: string };
}

/** Posts the top page's discard action, turning a failure, redirect or thrown error into its status. */
async function discard(who: TestUser | null, id: string | null): Promise<number> {
	const body = new FormData();
	if (id !== null) body.set('id', id);
	const request = new Request(`${ORIGIN}/?/discardDraft`, { method: 'POST', body });
	try {
		const result = await topActions.discardDraft({
			locals: who ? sessionLocals(who) : ({} as App.Locals),
			request
		} as never);
		return isActionFailure(result) ? result.status : 200;
	} catch (e) {
		if (isRedirect(e) || isHttpError(e)) return e.status;
		throw e;
	}
}

describe('saving a draft', () => {
	test('create, then update with the version read, which moves the version on', async () => {
		const { author } = await setup();

		const first = await created(author, '一回目');
		expect(first.version).toBe(1);
		expect((await stored(first.id))?.payload).toEqual(payload('一回目'));

		const second = await call(PUT, {
			who: author,
			method: 'PUT',
			id: first.id,
			body: { version: 1, payload: payload('二回目') }
		});

		expect(second.status).toBe(200);
		expect(second.body?.version).toBe(2);
		const row = await stored(first.id);
		expect(row?.version).toBe(2);
		expect(row?.payload).toEqual(payload('二回目'));
		expect(row!.updatedAt.getTime()).toBeGreaterThanOrEqual(new Date(first.updatedAt).getTime());
		// Only the mirror is read: a draft never costs a Discord call.
		expect(discord.count()).toBe(0);
	});

	test('a stale version is a 409 and changes nothing', async () => {
		const { author } = await setup();
		const { id } = await created(author, '最初');
		await call(PUT, { who: author, method: 'PUT', id, body: { version: 1, payload: payload('別の画面') } });

		const stale = await call(PUT, {
			who: author,
			method: 'PUT',
			id,
			body: { version: 1, payload: payload('古い画面') }
		});

		expect(stale).toEqual({ status: 409, body: { reason: 'conflict' } });
		const row = await stored(id);
		expect(row?.version).toBe(2);
		expect(row?.payload).toEqual(payload('別の画面'));
	});

	test('a draft that is gone is a 409 too', async () => {
		const { author } = await setup();
		const { id } = await created(author);
		expect(await discard(author, id)).toBe(200);

		const late = await call(PUT, { who: author, method: 'PUT', id, body: { version: 1, payload: payload('x') } });

		expect(late).toEqual({ status: 409, body: { reason: 'conflict' } });
		expect(await stored(id)).toBeNull();
	});

	test('someone else’s draft can be neither read, written nor discarded', async () => {
		const { author, other } = await setup();
		const { id } = await created(author, '他人には見せない');

		const put = await call(PUT, { who: other, method: 'PUT', id, body: { version: 1, payload: payload('乗っ取り') } });
		const discarded = await discard(other, id);
		let loadStatus: number | 'ok' = 'ok';
		try {
			await newLoad({ locals: sessionLocals(other), url: new URL(`${ORIGIN}/forms/new?draft=${id}`) } as never);
		} catch (e) {
			loadStatus = isHttpError(e) ? e.status : -1;
		}

		expect(put.status).toBe(404);
		expect(discarded).toBe(404);
		expect(loadStatus).toBe(404);
		const row = await stored(id);
		expect(row?.version).toBe(1);
		expect(row?.payload).toEqual(payload('他人には見せない'));
	});

	test('another origin, or none, is refused before anything is read', async () => {
		const { author } = await setup();
		const { id } = await created(author);
		const foreign = { origin: 'http://evil.test' };

		const post = await call(POST, { who: author, method: 'POST', body: { payload: payload('x') }, headers: foreign });
		const put = await call(PUT, { who: author, method: 'PUT', id, body: { version: 1, payload: payload('x') }, headers: foreign });
		const missing = await call(POST, {
			who: author,
			method: 'POST',
			body: { payload: payload('x') },
			headers: { origin: '' }
		});

		expect([post.status, put.status, missing.status]).toEqual([403, 403, 403]);
		expect((await stored(id))?.version).toBe(1);
		expect(await db.$count(formDraft)).toBe(1);
	});

	test('a body of exactly MAX_DRAFT_BYTES is saved, and one byte more is a 413', async () => {
		const { author } = await setup();
		const { id } = await created(author);
		/** A body of `bytes` UTF-8 bytes, mostly Japanese, so that bytes rather than characters count. */
		const body = (version: number, bytes: number) => {
			const bare = JSON.stringify({ version, payload: payload('') });
			const room = bytes - utf8Bytes(bare);
			const title = 'あ'.repeat(Math.floor(room / 3)) + 'x'.repeat(room % 3);
			const text = JSON.stringify({ version, payload: payload(title) });
			expect(utf8Bytes(text)).toBe(bytes);
			return text;
		};

		const exact = await call(PUT, { who: author, method: 'PUT', id, raw: body(1, MAX_DRAFT_BYTES) });
		const over = await call(PUT, { who: author, method: 'PUT', id, raw: body(2, MAX_DRAFT_BYTES + 1) });
		const declared = await call(POST, {
			who: author,
			method: 'POST',
			body: { payload: payload('x') },
			headers: { 'content-length': String(MAX_DRAFT_BYTES + 1) }
		});

		expect(exact.status).toBe(200);
		expect(over.status).toBe(413);
		expect(over.body?.message).toContain('大きすぎる');
		expect(declared.status).toBe(413);
		expect((await stored(id))?.version).toBe(2);
	});

	test('the body must be JSON with an object payload, and an update needs a version', async () => {
		const { author } = await setup();
		const { id } = await created(author);

		const statuses = await Promise.all([
			call(POST, { who: author, method: 'POST', raw: '{not json' }),
			call(POST, { who: author, method: 'POST', body: { payload: [] } }),
			call(POST, { who: author, method: 'POST', body: ['payload'] }),
			call(PUT, { who: author, method: 'PUT', id, body: { payload: payload('x') } }),
			call(PUT, { who: author, method: 'PUT', id, body: { version: '1', payload: payload('x') } })
		]);

		expect(statuses.map((s) => s.status)).toEqual([400, 400, 400, 400, 400]);
	});

	test('the content itself is not validated: an incomplete editor state is saved', async () => {
		const { author } = await setup();
		const odd = { v: 1, fields: { title: [''], questions: ['[{"type":"single","label":""}]'] } };

		const result = await call(POST, { who: author, method: 'POST', body: { payload: odd } });

		expect(result.status).toBe(201);
		expect((await stored(String(result.body?.id)))?.payload).toEqual(odd as never);
	});

	test('anonymous visitors get a 401 and non-members a 403', async () => {
		await setup();
		const [outsider] = await createUsers([snowflake(9)]);

		const anonymous = await call(POST, { who: null, method: 'POST', body: { payload: payload('x') } });
		const stranger = await call(POST, { who: outsider, method: 'POST', body: { payload: payload('x') } });

		expect(anonymous.status).toBe(401);
		expect(stranger.status).toBe(403);
		expect(await db.$count(formDraft)).toBe(0);
	});
});

describe('opening a draft', () => {
	test('the load returns the editor state read from the payload, not the payload', async () => {
		const { author } = await setup();
		const saved = draftPayload(
			{
				title: ['続き'],
				targetRoleId: [TARGET_ROLE],
				questions: ['[{"type":"multi","label":"日程","options":[{"id":"a","label":"A"}],"allowOther":true}]'],
				unknownField: ['使わない値']
			},
			true
		);
		const { id } = (await call(POST, { who: author, method: 'POST', body: { payload: saved } })).body as {
			id: string;
		};

		const data = (await newLoad({
			locals: sessionLocals(author),
			url: new URL(`${ORIGIN}/forms/new?draft=${id}`)
		} as never)) as { draft: { id: string; version: number; state: unknown } };

		expect(data.draft.id).toBe(id);
		expect(data.draft.version).toBe(1);
		expect(data.draft.state).toEqual(readDraftPayload(saved));
		expect(JSON.stringify(data)).not.toContain('使わない値');
	});
});

describe('discarding a draft', () => {
	test('the author discards their own draft once; a second discard is a 404', async () => {
		const { author } = await setup();
		const { id } = await created(author);
		const { id: kept } = await created(author, '残す');

		expect(await discard(author, id)).toBe(200);
		expect(await discard(author, id)).toBe(404);

		expect(await stored(id)).toBeNull();
		expect(await stored(kept)).not.toBeNull();
		// Judged by the mirror, like saving.
		expect(discord.count()).toBe(0);
	});

	test('no id is a 404, anonymous visitors are sent to the top, and non-members get a 403', async () => {
		const { author } = await setup();
		const { id } = await created(author);
		const [outsider] = await createUsers([snowflake(9)]);

		const statuses = [await discard(author, null), await discard(null, id), await discard(outsider, id)];

		expect(statuses).toEqual([404, 303, 403]);
		expect(await stored(id)).not.toBeNull();
	});
});

describe('creating the form removes its draft', () => {
	function formData(fields: Record<string, string>) {
		const data = new FormData();
		for (const [name, value] of Object.entries(fields)) data.set(name, value);
		return data;
	}

	test('a successful creation deletes the draft named in the submission', async () => {
		const { author } = await setup();
		const { id: draftId } = await created(author, '作成前');
		const request = new Request(`${ORIGIN}/forms/new`, {
			method: 'POST',
			body: formData({
				title: '作成後',
				targetRoleId: TARGET_ROLE,
				questions: JSON.stringify([{ type: 'text', label: '名前', helpText: '', required: true, options: null }]),
				draftId
			})
		});

		let redirected = false;
		try {
			await newActions.default({ locals: sessionLocals(author), request } as never);
		} catch (e) {
			redirected = isRedirect(e);
		}

		expect(redirected).toBe(true);
		expect(await db.$count(form)).toBe(1);
		expect(await stored(draftId)).toBeNull();
	});

	test('the deletion shares the creation’s transaction: a failed creation keeps the draft', async () => {
		const { author } = await setup();
		const { id: draftId } = await created(author);
		const input = {
			title: 't',
			description: null,
			targetRoleId: TARGET_ROLE,
			submitScope: 'everyone' as const,
			visibility: 'public' as const,
			deadline: null,
			closesAt: null,
			allowEdit: true,
			announcementChannelId: null,
			announceClose: true,
			// Fails in the question insert, after the draft's delete has run.
			questions: [{ ...DEFAULT_QUESTIONS[0], type: 'bogus' as never }]
		};

		await expect(createForm(input, author.id, draftId)).rejects.toThrow();

		expect(await stored(draftId)).not.toBeNull();
		expect(await db.$count(form)).toBe(0);
	});

	test('a draft id belonging to someone else is left alone', async () => {
		const { author, other } = await setup();
		const { id: othersDraft } = await created(other);

		await makeForm(author);
		await createForm(
			{
				title: 't',
				description: null,
				targetRoleId: TARGET_ROLE,
				submitScope: 'everyone',
				visibility: 'public',
				deadline: null,
				closesAt: null,
				allowEdit: true,
				announcementChannelId: null,
				announceClose: true,
				questions: DEFAULT_QUESTIONS
			},
			author.id,
			othersDraft
		);

		expect(await stored(othersDraft)).not.toBeNull();
	});
});

describe('duplicating a form', () => {
	async function duplicate(who: TestUser, formId: string): Promise<{ status: number; location?: string }> {
		try {
			await resultsActions.duplicate({ locals: sessionLocals(who), params: { id: formId } } as never);
			return { status: 200 };
		} catch (e) {
			if (isRedirect(e)) return { status: e.status, location: e.location };
			if (isHttpError(e)) return { status: e.status };
			throw e;
		}
	}

	test('a member who neither created the form nor administers the guild is refused', async () => {
		const { author, other } = await setup();
		const source = await makeForm(author);

		expect(await duplicate(other, source.id)).toEqual({ status: 403 });
		expect(await db.$count(formDraft)).toBe(0);
	});

	test('the creator and an admin each get a draft of their own', async () => {
		const { author, admin } = await setup();
		const source = await makeForm(author);

		const byCreator = await duplicate(author, source.id);
		const byAdmin = await duplicate(admin, source.id);

		expect(byCreator.status).toBe(303);
		expect(byAdmin.status).toBe(303);
		const drafts = await db.select().from(formDraft);
		expect(drafts.map((d) => d.createdBy).sort()).toEqual([author.id, admin.id].sort());
		for (const draft of drafts) {
			const own = draft.createdBy === author.id ? byCreator : byAdmin;
			expect(own.location).toBe(`/forms/new?draft=${draft.id}`);
		}
	});

	test('the copy carries the settings and live questions, never the deadlines', async () => {
		const { author } = await setup();
		const source = await makeForm(author, {
			title: '春合宿',
			description: '説明文',
			submitScope: 'target_role',
			visibility: 'after_deadline',
			allowEdit: false,
			announcementChannelId: CHANNEL_ID,
			announceClose: false,
			deadline: new Date(Date.now() + 86_400_000),
			closesAt: new Date(Date.now() + 2 * 86_400_000),
			questions: [
				DEFAULT_QUESTIONS[0],
				{ ...DEFAULT_QUESTIONS[0], label: '削除済み' },
				DEFAULT_QUESTIONS[1]
			]
		});
		await db.update(question).set({ deletedAt: new Date() }).where(eq(question.id, source.questions[1].id));
		const [before] = await db.select().from(form).where(eq(form.id, source.id));

		const { location } = await duplicate(author, source.id);
		const draftId = new URL(`${ORIGIN}${location}`).searchParams.get('draft')!;
		const state = readDraftPayload((await stored(draftId))?.payload);

		expect(state).toEqual({
			title: '春合宿のコピー',
			description: '説明文',
			targetRoleId: TARGET_ROLE,
			announcementChannelId: CHANNEL_ID,
			announceClose: false,
			submitScope: 'target_role',
			visibility: 'after_deadline',
			deadline: '',
			closesAt: '',
			allowEdit: false,
			closesAtTouched: false,
			questions: [
				{ type: 'text', label: '名前', helpText: '', required: true, options: [], allowOther: false },
				{
					type: 'single',
					label: '参加',
					helpText: '',
					required: false,
					options: [
						{ id: 'yes', label: '出席' },
						{ id: 'no', label: '欠席' }
					],
					allowOther: true
				}
			]
		});
		// Only read: the source form is exactly as it was.
		const [after] = await db.select().from(form).where(eq(form.id, source.id));
		expect(after).toEqual(before);
	});
});
