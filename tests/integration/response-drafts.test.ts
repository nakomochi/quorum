import { describe, expect, test } from 'bun:test';
import { isHttpError } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { responseDraft } from '$lib/server/db/schema';
import { closeForm, reopenForm } from '$lib/server/forms';
import { MAX_QUESTIONS, MAX_OPTIONS, MAX_RESPONSE_BYTES, utf8Bytes, type RevisionAnswers } from '$lib/forms';
import { MAX_RESPONSE_DRAFT_BYTES } from '$lib/response-draft';
import { saveResponseDraft } from '$lib/server/response-drafts';
import { DELETE, PUT } from '../../src/routes/forms/[id]/draft/+server';
import { load as formLoad } from '../../src/routes/forms/[id]/+page.server';
import { discord, OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	patchForm,
	seedGuild,
	sessionLocals,
	settle,
	sleep,
	snowflake,
	submit,
	type TestUser
} from '../helpers/fixtures';

const ORIGIN = 'http://forms.test';

type Call = { status: number; body: Record<string, unknown> | null };

/** Runs a handler as SvelteKit would, turning a thrown error() into its status. */
async function call(
	handler: (event: never) => Promise<Response> | Response,
	options: {
		who: TestUser | null;
		formId: string;
		body?: unknown;
		raw?: string;
		headers?: Record<string, string>;
	}
): Promise<Call> {
	const method = handler === DELETE ? 'DELETE' : 'PUT';
	const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
	const request = new Request(`${ORIGIN}/forms/${options.formId}/draft`, {
		method,
		headers: { origin: ORIGIN, 'content-type': 'application/json', ...options.headers },
		body
	});
	const event = {
		request,
		url: new URL(request.url),
		params: { id: options.formId },
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

function save(who: TestUser, formId: string, version: number, answers: RevisionAnswers) {
	return call(PUT, { who, formId, body: { version, answers } });
}

async function stored(formId: string, userId: string) {
	const [row] = await db
		.select()
		.from(responseDraft)
		.where(and(eq(responseDraft.formId, formId), eq(responseDraft.userId, userId)));
	return row ?? null;
}

async function draftCount(formId: string) {
	return db.$count(responseDraft, eq(responseDraft.formId, formId));
}

async function setup() {
	const [creator, who, other, outsider] = await createUsers([1, 2, 3, 4].map(snowflake));
	await seedGuild([
		member(creator.discordId, [OTHER_ROLE]),
		member(who.discordId, [TARGET_ROLE]),
		member(other.discordId, [TARGET_ROLE]),
		member(outsider.discordId, [OTHER_ROLE])
	]);
	return { creator, who, other, outsider };
}

/** A form open to the target role, with `key` naming its first question in a draft. */
async function openForm(creator: TestUser, overrides: Parameters<typeof makeForm>[1] = {}) {
	const made = await makeForm(creator, { submitScope: 'target_role', ...overrides });
	return { ...made, key: String(made.questions[0].id) };
}

const textFor = (key: string, value: string): RevisionAnswers => ({ [key]: { type: 'text', text: value } });

/** Stretches every write to response_draft, inside the writer's transaction. */
async function withSlowDrafts<T>(seconds: number, fn: () => Promise<T>): Promise<T> {
	await db.execute(
		sql.raw(`create or replace function test_sleep_draft() returns trigger language plpgsql as $$
			begin
				perform pg_sleep(${seconds});
				return coalesce(new, old);
			end $$`)
	);
	await db.execute(
		sql.raw(
			'create trigger test_slow_draft before insert or update or delete on response_draft for each row execute function test_sleep_draft()'
		)
	);
	try {
		return await fn();
	} finally {
		await db.execute(sql.raw('drop trigger test_slow_draft on response_draft'));
	}
}

describe('saving an answer draft', () => {
	test('version 0 creates it, and each save moves the version it names on', async () => {
		const { creator, who } = await setup();
		const { id, key } = await openForm(creator);

		const first = await save(who, id, 0, textFor(key, '書きかけ'));
		const second = await save(who, id, 1, textFor(key, '書きかけ、続き'));

		expect(first.status).toBe(200);
		expect(first.body?.version).toBe(1);
		expect(second.status).toBe(200);
		expect(second.body?.version).toBe(2);
		const row = await stored(id, who.id);
		expect(row?.version).toBe(2);
		expect(row?.answers).toEqual(textFor(key, '書きかけ、続き'));
		expect(row!.updatedAt.getTime()).toBeGreaterThanOrEqual(new Date(String(first.body?.updatedAt)).getTime());
		// Judged by the mirror: a draft never costs a Discord call.
		expect(discord.count()).toBe(0);
	});

	test('a stale version is a 409 conflict and changes nothing', async () => {
		const { creator, who } = await setup();
		const { id, key } = await openForm(creator);
		await save(who, id, 0, textFor(key, '一'));
		await save(who, id, 1, textFor(key, '別の画面'));

		const stale = await save(who, id, 1, textFor(key, '古い画面'));
		const again = await save(who, id, 0, textFor(key, '古い画面'));

		expect(stale).toEqual({ status: 409, body: { reason: 'conflict' } });
		expect(again).toEqual({ status: 409, body: { reason: 'conflict' } });
		const row = await stored(id, who.id);
		expect(row?.version).toBe(2);
		expect(row?.answers).toEqual(textFor(key, '別の画面'));
	});

	test('a version for a draft that is gone is a 409 conflict, and nothing is created', async () => {
		const { creator, who } = await setup();
		const { id, key } = await openForm(creator);
		await save(who, id, 0, textFor(key, '一'));
		expect((await call(DELETE, { who, formId: id })).status).toBe(204);

		const late = await save(who, id, 1, textFor(key, '遅れて届いた'));

		expect(late).toEqual({ status: 409, body: { reason: 'conflict' } });
		expect(await stored(id, who.id)).toBeNull();
	});

	test('a form past closes_at, or closed, is a 409 closed', async () => {
		const { creator, who } = await setup();
		const expired = await openForm(creator);
		const closed = await openForm(creator);
		await save(who, expired.id, 0, textFor(expired.key, '前'));
		await patchForm(expired.id, { closesAt: new Date(Date.now() - 1000) });
		await patchForm(closed.id, { closedAt: new Date() });

		const pastClosesAt = await save(who, expired.id, 1, textFor(expired.key, '後'));
		const pastClosedAt = await save(who, closed.id, 0, textFor(closed.key, '後'));

		expect(pastClosesAt).toEqual({ status: 409, body: { reason: 'closed' } });
		expect(pastClosedAt).toEqual({ status: 409, body: { reason: 'closed' } });
		expect((await stored(expired.id, who.id))?.answers).toEqual(textFor(expired.key, '前'));
		expect(await stored(closed.id, who.id)).toBeNull();
	});

	test('another origin, or none, is refused before anything is read or written', async () => {
		const { creator, who } = await setup();
		const { id, key } = await openForm(creator);
		await save(who, id, 0, textFor(key, '一'));
		const foreign = { origin: 'http://evil.test' };

		const put = await call(PUT, { who, formId: id, body: { version: 1, answers: textFor(key, 'x') }, headers: foreign });
		const del = await call(DELETE, { who, formId: id, headers: foreign });
		const missing = await call(PUT, {
			who,
			formId: id,
			body: { version: 1, answers: textFor(key, 'x') },
			headers: { origin: '' }
		});

		expect([put.status, del.status, missing.status]).toEqual([403, 403, 403]);
		expect(await stored(id, who.id)).toMatchObject({ version: 1, answers: textFor(key, '一') });
	});

	test('a body of exactly MAX_RESPONSE_DRAFT_BYTES is saved, and one byte more is a 413', async () => {
		const { creator, who } = await setup();
		const { id, key } = await openForm(creator);
		/** A body of `bytes` UTF-8 bytes, mostly Japanese, so that bytes rather than characters count. */
		const body = (version: number, bytes: number) => {
			const bare = JSON.stringify({ version, answers: textFor(key, '') });
			const room = bytes - utf8Bytes(bare);
			const value = 'あ'.repeat(Math.floor(room / 3)) + 'x'.repeat(room % 3);
			const raw = JSON.stringify({ version, answers: textFor(key, value) });
			expect(utf8Bytes(raw)).toBe(bytes);
			return raw;
		};

		const exact = await call(PUT, { who, formId: id, raw: body(0, MAX_RESPONSE_DRAFT_BYTES) });
		const over = await call(PUT, { who, formId: id, raw: body(1, MAX_RESPONSE_DRAFT_BYTES + 1) });
		const declared = await call(PUT, {
			who,
			formId: id,
			body: { version: 1, answers: textFor(key, 'x') },
			headers: { 'content-length': String(MAX_RESPONSE_DRAFT_BYTES + 1) }
		});

		expect(exact.status).toBe(200);
		expect(over.status).toBe(413);
		expect(declared.status).toBe(413);
		expect((await stored(id, who.id))?.version).toBe(1);
	});

	test('the worst answers within MAX_RESPONSE_BYTES fit: control characters, and every option chosen', async () => {
		const { creator, who } = await setup();
		// Control characters take a six-byte \u escape each.
		const texts = await openForm(creator, {
			questions: Array.from({ length: 13 }, (_, i) => ({
				type: 'text' as const,
				label: `t${i}`,
				helpText: null,
				required: false,
				options: null,
				allowOther: false
			}))
		});
		const control: RevisionAnswers = {};
		let left = MAX_RESPONSE_BYTES;
		for (const q of texts.questions) {
			const size = Math.min(left, 4000);
			control[String(q.id)] = { type: 'text', text: '\u0001'.repeat(size) };
			left -= size;
		}
		// The most structure per byte counted: every option of every question, with one-byte ids.
		const ids = Array.from({ length: MAX_OPTIONS }, (_, i) => String.fromCharCode(0x21 + i));
		const choices = await openForm(creator, {
			questions: Array.from({ length: MAX_QUESTIONS }, (_, i) => ({
				type: 'multi' as const,
				label: `m${i}`,
				helpText: null,
				required: false,
				options: ids.map((optionId) => ({ id: optionId, label: optionId })),
				allowOther: true
			}))
		});
		const perOther = Math.floor((MAX_RESPONSE_BYTES - MAX_QUESTIONS * MAX_OPTIONS) / MAX_QUESTIONS);
		const everything: RevisionAnswers = Object.fromEntries(
			choices.questions.map((q) => [
				String(q.id),
				{ type: 'multi', optionIds: ids, other: '\u0001'.repeat(perOther) }
			])
		);

		for (const [formId, answers] of [
			[texts.id, control],
			[choices.id, everything]
		] as const) {
			const raw = JSON.stringify({ version: 0, answers });
			expect(utf8Bytes(raw)).toBeLessThanOrEqual(MAX_RESPONSE_DRAFT_BYTES);
			expect((await call(PUT, { who, formId, raw })).status).toBe(200);
		}
	}, 20_000);

	test('the body must be JSON with an object for answers and a whole version from 0', async () => {
		const { creator, who } = await setup();
		const { id, key } = await openForm(creator);

		const results = await Promise.all([
			call(PUT, { who, formId: id, raw: '{not json' }),
			call(PUT, { who, formId: id, body: { version: 0, answers: [] } }),
			call(PUT, { who, formId: id, body: { answers: textFor(key, 'x') } }),
			call(PUT, { who, formId: id, body: { version: -1, answers: textFor(key, 'x') } }),
			call(PUT, { who, formId: id, body: { version: 1.5, answers: textFor(key, 'x') } })
		]);

		expect(results.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
		expect(await draftCount(id)).toBe(0);
	});

	test('someone the answer page would refuse gets a 403, and no login a 401', async () => {
		const { creator, outsider } = await setup();
		const { id, key } = await openForm(creator);
		const [stranger] = await createUsers([snowflake(9)]);

		const offTarget = await save(outsider, id, 0, textFor(key, 'x'));
		const notMember = await save(stranger, id, 0, textFor(key, 'x'));
		const anonymous = await call(PUT, { who: null, formId: id, body: { version: 0, answers: textFor(key, 'x') } });
		const discardOffTarget = await call(DELETE, { who: outsider, formId: id });

		expect([offTarget.status, notMember.status, anonymous.status, discardOffTarget.status]).toEqual([
			403, 403, 401, 403
		]);
		expect(await draftCount(id)).toBe(0);
	});

	test('discarding removes only the caller’s own draft', async () => {
		const { creator, who, other } = await setup();
		const { id, key } = await openForm(creator);
		await save(who, id, 0, textFor(key, '自分'));
		await save(other, id, 0, textFor(key, '他人'));

		expect((await call(DELETE, { who, formId: id })).status).toBe(204);
		expect((await call(DELETE, { who, formId: id })).status).toBe(204);

		expect(await stored(id, who.id)).toBeNull();
		expect((await stored(id, other.id))?.answers).toEqual(textFor(key, '他人'));
	});

	test('an unknown form is a 404', async () => {
		const { who } = await setup();

		expect((await save(who, 'nonexistent0', 0, textFor('1', 'x'))).status).toBe(404);
	});
});

describe('sending and closing remove drafts', () => {
	test('a submission deletes the submitter’s draft for that form only', async () => {
		const { creator, who, other } = await setup();
		const target = await openForm(creator);
		const elsewhere = await openForm(creator);
		await save(who, target.id, 0, textFor(target.key, '送る前'));
		await save(who, elsewhere.id, 0, textFor(elsewhere.key, '別のフォーム'));
		await save(other, target.id, 0, textFor(target.key, '他人'));

		const result = await submit(target.id, who, [TARGET_ROLE], inputs(target.questions, { 0: '送った' }));

		expect(result).toMatchObject({ ok: true });
		expect(await stored(target.id, who.id)).toBeNull();
		expect(await stored(elsewhere.id, who.id)).not.toBeNull();
		expect(await stored(target.id, other.id)).not.toBeNull();
	});

	test('an edit, and a resubmission of the same content, delete it too', async () => {
		const { creator, who } = await setup();
		const { id, key, questions } = await openForm(creator);
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '一回目' }));

		await save(who, id, 0, textFor(key, '編集中'));
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '二回目' }));
		const afterEdit = await stored(id, who.id);
		await save(who, id, 0, textFor(key, '編集中'));
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '二回目' }));

		expect(afterEdit).toBeNull();
		expect(await stored(id, who.id)).toBeNull();
	});

	test('the deletion shares the submission’s transaction: a failed submission keeps the draft', async () => {
		const { creator, who } = await setup();
		const { id, key, questions } = await openForm(creator);
		await save(who, id, 0, textFor(key, '残る'));
		await db.execute(
			sql.raw(`create or replace function test_fail() returns trigger language plpgsql as $$
				begin raise exception 'test failure'; end $$`)
		);
		await db.execute(
			sql.raw('create trigger test_fail_revision before insert on response_revision for each row execute function test_fail()')
		);

		try {
			const result = await settle(submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '失敗する' })));
			expect(result.ok).toBe(false);
		} finally {
			await db.execute(sql.raw('drop trigger test_fail_revision on response_revision'));
		}

		expect((await stored(id, who.id))?.answers).toEqual(textFor(key, '残る'));
	});

	test('a refused submission keeps the draft', async () => {
		const { creator, who } = await setup();
		const { id, key, questions } = await openForm(creator, { allowEdit: false });
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '一回目' }));
		await db.insert(responseDraft).values({ formId: id, userId: who.id, answers: textFor(key, '残る') });

		const result = await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '二回目' }));

		expect(result).toEqual({ ok: false, reason: 'already_submitted' });
		expect(await stored(id, who.id)).not.toBeNull();
	});

	test('closing deletes every draft of the form, and reopening does not bring them back', async () => {
		const { creator, who, other } = await setup();
		const target = await openForm(creator);
		const elsewhere = await openForm(creator);
		await save(who, target.id, 0, textFor(target.key, '一'));
		await save(other, target.id, 0, textFor(target.key, '二'));
		await save(who, elsewhere.id, 0, textFor(elsewhere.key, '別'));

		expect(await closeForm(target.id)).toMatchObject({ ok: true });
		expect(await draftCount(target.id)).toBe(0);
		expect(await draftCount(elsewhere.id)).toBe(1);

		await reopenForm(target.id);
		expect(await draftCount(target.id)).toBe(0);
	});

	test('the scheduler’s close at closes_at deletes them too', async () => {
		const { creator, who } = await setup();
		const { id, key } = await openForm(creator);
		await save(who, id, 0, textFor(key, '一'));
		await patchForm(id, { closesAt: new Date(Date.now() - 1000) });

		expect(await closeForm(id, 'closes_at')).toMatchObject({ ok: true });
		expect(await draftCount(id)).toBe(0);
	});
});

describe('concurrency', () => {
	test('saves racing a close never leave a draft behind, and never deadlock', async () => {
		const ids = Array.from({ length: 9 }, (_, i) => snowflake(i + 1));
		const [creator, ...users] = await createUsers(ids);
		await seedGuild(ids.map((id) => member(id)));

		const early = users.slice(0, 4);
		const late = users.slice(4);
		const seen = new Set<string>();
		for (let round = 0; round < 5; round++) {
			const { id, key } = await openForm(creator, { submitScope: 'everyone' });
			for (const u of [...early, ...late.slice(0, 2)]) {
				await saveResponseDraft(id, u.id, 0, textFor(key, '最初'));
			}

			// Every draft write sleeps inside its transaction, so the close holds FOR UPDATE for a
			// while as it deletes, and the late saves arrive in the middle of it. Half of them create
			// a draft (version 0), which no row lock of the close's delete could stop.
			const outcomes = await withSlowDrafts(0.05, async () => {
				const before = early.map((u) => settle(saveResponseDraft(id, u.id, 1, textFor(key, '前'))));
				await sleep(10);
				const closing = settle(closeForm(id));
				await sleep(150);
				const after = late.map((u, i) =>
					settle(saveResponseDraft(id, u.id, i < 2 ? 1 : 0, textFor(key, '後')))
				);
				return Promise.all([...before, closing, ...after]);
			});

			const errors = outcomes.filter((o) => !o.ok).map((o) => (o.ok ? '' : o.code));
			expect(errors).toEqual([]);
			const reasons = outcomes.map((o) =>
				o.ok ? ('frozen' in o.value ? 'close' : o.value.ok ? 'saved' : o.value.reason) : 'error'
			);
			expect(reasons.every((r) => r === 'saved' || r === 'closed' || r === 'close')).toBe(true);
			expect(await draftCount(id)).toBe(0);
			reasons.forEach((r) => seen.add(r));
		}
		// Both orders happened: saves that landed before the close, and saves that found it closed.
		expect([...seen].sort()).toEqual(['close', 'closed', 'saved']);
	}, 30_000);

	test('one person’s save and submission at once never deadlock, and no draft survives', async () => {
		const { creator, who } = await setup();

		for (let round = 0; round < 8; round++) {
			const { id, key, questions } = await openForm(creator);
			// Every other round is an edit, which locks the response FOR UPDATE instead of inserting it.
			if (round % 2 === 1) await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '提出済み' }));
			await saveResponseDraft(id, who.id, 0, textFor(key, '最初'));

			const [saved, sent] = await withSlowDrafts(0.05, () =>
				Promise.all([
					settle(saveResponseDraft(id, who.id, 1, textFor(key, '保存'))),
					settle(submit(id, who, [TARGET_ROLE], inputs(questions, { 0: `送信 ${round}` })))
				])
			);

			expect(saved.ok ? 'ok' : saved.code).toBe('ok');
			expect(sent.ok ? 'ok' : sent.code).toBe('ok');
			expect(sent.ok && sent.value.ok).toBe(true);
			expect(await stored(id, who.id)).toBeNull();
		}
	}, 30_000);
});

describe('opening the answer page', () => {
	type AnswerPage = {
		answers: RevisionAnswers;
		draft: { version: number; updatedAt: Date; answers: RevisionAnswers | null } | null;
		history: { number: number; createdAt: Date; answers: RevisionAnswers }[];
		editable: boolean;
	};

	const open = (who: TestUser, formId: string) =>
		formLoad({
			locals: sessionLocals(who),
			params: { id: formId },
			url: new URL(`${ORIGIN}/forms/${formId}`)
		} as never) as Promise<AnswerPage>;

	test('an unsubmitted person’s draft is returned as the answers to start from', async () => {
		const { creator, who } = await setup();
		const { id, key, questions } = await openForm(creator);
		const second = String(questions[1].id);
		await save(who, id, 0, {
			[key]: { type: 'text', text: '  書きかけ ' },
			[second]: { type: 'single', optionId: 'removed-option' },
			'99999': { type: 'text', text: '消えた質問' }
		});

		const data = await open(who, id);

		expect(data.answers).toEqual({});
		expect(data.draft).toEqual({
			version: 1,
			updatedAt: expect.any(Date),
			answers: { [key]: { type: 'text', text: '  書きかけ ' } }
		});
		expect(JSON.stringify(data)).not.toContain('消えた質問');
	});

	test('a draft equal to the submitted answers is no unsent change, but keeps its version', async () => {
		const { creator, who } = await setup();
		const { id, key, questions } = await openForm(creator);
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '山田', 1: 'yes' }));
		await save(who, id, 0, {
			[key]: { type: 'text', text: ' 山田\n' },
			[String(questions[1].id)]: { type: 'single', optionId: 'yes' }
		});

		const data = await open(who, id);

		expect(data.draft).toEqual({ version: 1, updatedAt: expect.any(Date), answers: null });
	});

	test('an empty draft of an unsubmitted person is no change either', async () => {
		const { creator, who } = await setup();
		const { id } = await openForm(creator);
		await save(who, id, 0, {});

		expect((await open(who, id)).draft).toMatchObject({ version: 1, answers: null });
	});

	test('a submitted person’s differing draft comes with the submitted answers kept apart', async () => {
		const { creator, who } = await setup();
		const { id, key, questions } = await openForm(creator);
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '山田' }));
		await save(who, id, 0, textFor(key, '田中'));

		const data = await open(who, id);

		expect(data.answers).toEqual(textFor(key, '山田'));
		expect(data.draft?.answers).toEqual(textFor(key, '田中'));
	});

	test('no draft where it cannot be used: editing off after submitting, or closed', async () => {
		const { creator, who } = await setup();
		const locked = await openForm(creator, { allowEdit: false });
		await submit(locked.id, who, [TARGET_ROLE], inputs(locked.questions, { 0: '一' }));
		await db.insert(responseDraft).values({ formId: locked.id, userId: who.id, answers: textFor(locked.key, '二') });
		const expired = await openForm(creator);
		await save(who, expired.id, 0, textFor(expired.key, '書きかけ'));
		await patchForm(expired.id, { closesAt: new Date(Date.now() - 1000) });

		expect((await open(who, locked.id)).draft).toBeNull();
		expect((await open(who, expired.id)).draft).toBeNull();
	});

	test('the load only reads', async () => {
		const { creator, who } = await setup();
		const { id, key, questions } = await openForm(creator);
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '山田' }));
		await save(who, id, 0, textFor(key, '山田'));
		const before = await stored(id, who.id);

		await open(who, id);
		await open(who, id);

		expect(await stored(id, who.id)).toEqual(before);
	});

	test('the history is the viewer’s own revisions, newest first, from two on', async () => {
		const { creator, who, other } = await setup();
		const { id, key, questions } = await openForm(creator);
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '自分の一版目' }));
		await submit(id, other, [TARGET_ROLE], inputs(questions, { 0: '他人の一版目' }));
		const single = await open(who, id);
		await submit(id, who, [TARGET_ROLE], inputs(questions, { 0: '自分の二版目', 1: 'no' }));
		await submit(id, other, [TARGET_ROLE], inputs(questions, { 0: '他人の二版目' }));

		const data = await open(who, id);

		expect(single.history).toEqual([]);
		expect(data.history.map((r) => r.number)).toEqual([2, 1]);
		expect(data.history[0].answers).toEqual({
			[key]: { type: 'text', text: '自分の二版目' },
			[String(questions[1].id)]: { type: 'single', optionId: 'no' }
		});
		expect(data.history[1].answers).toEqual(textFor(key, '自分の一版目'));
		expect(JSON.stringify(data)).not.toContain('他人の');
	});

	test('nothing of another person’s draft or history reaches the page', async () => {
		const { creator, who, other } = await setup();
		const { id, key, questions } = await openForm(creator);
		await submit(id, other, [TARGET_ROLE], inputs(questions, { 0: '他人の回答一' }));
		await submit(id, other, [TARGET_ROLE], inputs(questions, { 0: '他人の回答二' }));
		await save(other, id, 0, textFor(key, '他人の下書き'));

		const data = await open(who, id);

		expect(data.draft).toBeNull();
		expect(data.history).toEqual([]);
		expect(data.answers).toEqual({});
		const textOut = JSON.stringify(data);
		for (const secret of ['他人の回答一', '他人の回答二', '他人の下書き', other.id, other.discordId]) {
			expect(textOut).not.toContain(secret);
		}
		// Exactly what the page draws, and nothing more.
		expect(Object.keys(data).sort()).toEqual(
			[
				'answers',
				'closed',
				'draft',
				'editable',
				'form',
				'history',
				'questions',
				'resultsVisible',
				'submittedAt',
				'updatedAt'
			].sort()
		);
	});
});
