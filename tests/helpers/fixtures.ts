import { spyOn } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { form, user, type Question } from '$lib/server/db/schema';
import {
	createForm,
	loadQuestions,
	submitResponse,
	type AnswerInputs,
	type CreateFormInput,
	type QuestionDraft
} from '$lib/server/forms';
import { syncAllMembers } from '$lib/server/guild-sync';
import { discord, TARGET_ROLE, type StubMember } from './discord';

const TABLES = [
	'user',
	'session',
	'account',
	'verification',
	'guild_member',
	'guild_sync',
	'form',
	'question',
	'response',
	'answer',
	'response_revision',
	'reminder',
	'form_draft',
	'response_draft'
];

export async function resetTables() {
	await db.execute(
		sql.raw(`truncate ${TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`)
	);
}

export function snowflake(n: number): string {
	return String(500000000000000000n + BigInt(n));
}

export type TestUser = { id: string; discordId: string; name: string };

export async function createUsers(discordIds: string[]): Promise<TestUser[]> {
	const users = discordIds.map((discordId) => ({
		id: `u-${discordId}`,
		discordId,
		name: `name-${discordId}`
	}));
	await db
		.insert(user)
		.values(users.map((u) => ({ ...u, email: `${u.discordId}@example.invalid` })));
	return users;
}

export async function createUser(discordId: string): Promise<TestUser> {
	return (await createUsers([discordId]))[0];
}

export function member(
	id: string,
	roles: string[] = [TARGET_ROLE],
	extra: Partial<StubMember> = {}
): StubMember {
	return { id, roles, ...extra };
}

/** Puts `members` in Discord and mirrors them, then forgets the calls the sync made. */
export async function seedGuild(members: StubMember[]) {
	discord.members = members;
	await syncAllMembers();
	discord.calls = [];
}

export const DEFAULT_QUESTIONS: QuestionDraft[] = [
	{ type: 'text', label: '名前', helpText: null, required: true, options: null, allowOther: false },
	{
		type: 'single',
		label: '参加',
		helpText: null,
		required: false,
		options: [
			{ id: 'yes', label: '出席' },
			{ id: 'no', label: '欠席' }
		],
		allowOther: true
	}
];

export async function makeForm(creator: TestUser, overrides: Partial<CreateFormInput> = {}) {
	const id = await createForm(
		{
			title: 'テストフォーム',
			description: null,
			targetRoleId: TARGET_ROLE,
			submitScope: 'everyone',
			visibility: 'public',
			deadline: null,
			closesAt: null,
			allowEdit: true,
			announcementChannelId: null,
			announceClose: true,
			questions: DEFAULT_QUESTIONS,
			...overrides
		},
		creator.id
	);
	return { id, questions: await loadQuestions(id) };
}

/** Bypasses the validation that parseCreateFormPayload and closeForm apply. */
export async function patchForm(formId: string, values: Partial<typeof form.$inferInsert>) {
	await db.update(form).set(values).where(eq(form.id, formId));
}

type RawInput = string | string[] | { values: string[]; other?: string };

/** Answer inputs keyed by question position, as collectAnswerInputs would build them. */
export function inputs(questions: Question[], byPosition: Record<number, RawInput>): AnswerInputs {
	const out: AnswerInputs = new Map();
	questions.forEach((q, position) => {
		const raw = byPosition[position];
		if (raw === undefined) out.set(q.id, { values: [], other: null });
		else if (typeof raw === 'string') out.set(q.id, { values: [raw], other: null });
		else if (Array.isArray(raw)) out.set(q.id, { values: raw, other: null });
		else out.set(q.id, { values: raw.values, other: raw.other ?? null });
	});
	return out;
}

export function submit(
	formId: string,
	who: TestUser,
	roleIds: string[],
	answers: AnswerInputs
) {
	return submitResponse(formId, { id: who.id, discordId: who.discordId }, { roleIds }, answers);
}

export function sessionLocals(who: TestUser, image: string | null = null): App.Locals {
	const now = new Date();
	return {
		user: {
			id: who.id,
			name: who.name,
			email: `${who.discordId}@example.invalid`,
			emailVerified: false,
			image,
			createdAt: now,
			updatedAt: now,
			discordId: who.discordId
		}
	} as App.Locals;
}

export type Settled<T> = { ok: true; value: T } | { ok: false; code: string; error: unknown };

/** The Postgres SQLSTATE of an error, looking through drizzle's wrapping. */
export function sqlState(error: unknown): string {
	let current = error as { code?: unknown; cause?: unknown } | undefined;
	while (current) {
		if (typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) return current.code;
		current = current.cause as typeof current;
	}
	return '?';
}

export async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
	try {
		return { ok: true, value: await promise };
	} catch (error) {
		return { ok: false, code: sqlState(error), error };
	}
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn` with console.error and console.warn silenced; returns what it returned and the logs. */
export async function quietly<T>(fn: () => Promise<T>): Promise<{ value: T; logged: unknown[][] }> {
	const logged: unknown[][] = [];
	const record = (...args: unknown[]) => void logged.push(args);
	const error = spyOn(console, 'error').mockImplementation(record);
	const warn = spyOn(console, 'warn').mockImplementation(record);
	try {
		return { value: await fn(), logged };
	} finally {
		error.mockRestore();
		warn.mockRestore();
	}
}

function literal(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Stretches a race window deterministically: a trigger that sleeps inside the writer's
 * transaction, while it holds its locks. Dropped again whatever `fn` does.
 */
export async function withSlowWrites<T>(
	target:
		| { table: 'response'; formId: string; seconds: number }
		| { table: 'question'; formId: string; seconds: number }
		| { table: 'guild_member'; seconds: number },
	fn: () => Promise<T>
): Promise<T> {
	await db.execute(
		sql.raw(`create or replace function test_sleep() returns trigger language plpgsql as $$
			begin
				perform pg_sleep(TG_ARGV[0]::float8);
				if TG_LEVEL = 'ROW' then return new; end if;
				return null;
			end $$`)
	);
	const seconds = literal(String(target.seconds));
	const spec =
		target.table === 'response'
			? `before insert on response for each row when (new.form_id = ${literal(target.formId)})`
			: target.table === 'question'
				? `before update on question for each row when (new.form_id = ${literal(target.formId)})`
				: 'after insert on guild_member for each statement';
	await db.execute(sql.raw(`create trigger test_slow_write ${spec} execute function test_sleep(${seconds})`));
	try {
		return await fn();
	} finally {
		await db.execute(sql.raw(`drop trigger test_slow_write on ${target.table}`));
	}
}
