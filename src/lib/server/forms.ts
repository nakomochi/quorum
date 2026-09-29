import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import {
	answer,
	form,
	guildMember,
	newFormId,
	question,
	response,
	responseRevision,
	type Form,
	type FrozenMember,
	type GuildMember,
	type Question,
	type QuestionOption
} from './db/schema';
import { guildId, listGuildRoles, type DiscordRole } from './discord';
import { syncAllMembers } from './guild-sync';
import { parseJstLocal } from '../datetime';
import {
	hasOptions,
	MAX_DESCRIPTION,
	MAX_HELP_TEXT,
	MAX_LABEL,
	MAX_OPTION_ID,
	MAX_OPTION_LABEL,
	MAX_OPTIONS,
	MAX_OTHER_ANSWER,
	MAX_QUESTIONS,
	MAX_TEXT_ANSWER,
	MAX_TITLE,
	OTHER_OPTION_ID,
	QUESTION_TYPES,
	sameAnswers,
	SUBMIT_SCOPES,
	VISIBILITIES,
	type AnswerValue,
	type QuestionType,
	type RevisionAnswers,
	type SubmitScope,
	type Visibility
} from '../forms';

const MAX_SNOWFLAKE = 32;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Rejected user input. Carries a message that is safe to show back on the form. */
export class FormInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FormInputError';
	}
}

/** Distinguishes a failed Discord refresh from a database fault while closing. */
export class RosterRefreshError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'RosterRefreshError';
	}
}

export type QuestionDraft = {
	type: QuestionType;
	label: string;
	helpText: string | null;
	required: boolean;
	options: QuestionOption[] | null;
	allowOther: boolean;
};

export type CreateFormInput = {
	title: string;
	description: string | null;
	targetRoleId: string;
	submitScope: SubmitScope;
	visibility: Visibility;
	deadline: Date | null;
	closesAt: Date | null;
	allowEdit: boolean;
	announcementChannelId: string | null;
	questions: QuestionDraft[];
};

/**
 * Roles an admin may target. @everyone carries no information (its id is the guild id and
 * Discord omits it from member.roles), and integration-managed roles are bot roles nobody can
 * be assigned by hand.
 */
export async function selectableRoles(): Promise<DiscordRole[]> {
	const id = guildId();
	return (await listGuildRoles())
		.filter((role) => role.id !== id && !role.managed)
		.sort((a, b) => b.position - a.position);
}

function requireText(value: FormDataEntryValue | null, field: string, max: number): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new FormInputError(`${field}を入力してください`);
	if (text.length > max) throw new FormInputError(`${field}は${max}文字以内で入力してください`);
	return text;
}

function optionalText(value: FormDataEntryValue | null, field: string, max: number): string | null {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) return null;
	if (text.length > max) throw new FormInputError(`${field}は${max}文字以内で入力してください`);
	return text;
}

function pickEnum<T extends string>(
	value: FormDataEntryValue | null,
	allowed: readonly T[],
	field: string,
	fallback?: T
): T {
	if (typeof value !== 'string' || value === '') {
		if (fallback !== undefined) return fallback;
		throw new FormInputError(`${field}を選択してください`);
	}
	if (!(allowed as readonly string[]).includes(value)) {
		throw new FormInputError(`${field}の値が不正です`);
	}
	return value as T;
}

function optionalDate(value: FormDataEntryValue | null, field: string): Date | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	const date = parseJstLocal(value);
	if (!date) throw new FormInputError(`${field}の日時が不正です`);
	return date;
}

function parseOptions(raw: unknown, type: QuestionType, index: number): QuestionOption[] | null {
	if (!hasOptions(type)) return null;
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new FormInputError(`質問${index + 1}: 選択肢を1つ以上追加してください`);
	}
	if (raw.length > MAX_OPTIONS) {
		throw new FormInputError(`質問${index + 1}: 選択肢は${MAX_OPTIONS}個までです`);
	}

	const seen = new Set<string>();
	return raw.map((entry) => {
		const option = entry as Partial<QuestionOption>;
		const id = typeof option.id === 'string' ? option.id.trim() : '';
		const label = typeof option.label === 'string' ? option.label.trim() : '';
		if (!id) throw new FormInputError(`質問${index + 1}: 選択肢の id がありません`);
		if (id === OTHER_OPTION_ID) {
			throw new FormInputError(`質問${index + 1}: 選択肢の id「${OTHER_OPTION_ID}」は使えません`);
		}
		if (id.length > MAX_OPTION_ID) {
			throw new FormInputError(`質問${index + 1}: 選択肢の id が長すぎます`);
		}
		if (seen.has(id)) throw new FormInputError(`質問${index + 1}: 選択肢の id が重複しています`);
		if (!label) throw new FormInputError(`質問${index + 1}: 選択肢のラベルを入力してください`);
		if (label.length > MAX_OPTION_LABEL) {
			throw new FormInputError(`質問${index + 1}: 選択肢は${MAX_OPTION_LABEL}文字以内です`);
		}
		seen.add(id);
		return { id, label };
	});
}

export function parseQuestions(raw: FormDataEntryValue | null): QuestionDraft[] {
	if (typeof raw !== 'string' || raw.trim() === '') {
		throw new FormInputError('質問を1つ以上追加してください');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new FormInputError('質問データを読み取れませんでした');
	}

	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new FormInputError('質問を1つ以上追加してください');
	}
	if (parsed.length > MAX_QUESTIONS) {
		throw new FormInputError(`質問は${MAX_QUESTIONS}件までです`);
	}

	return parsed.map((entry, index) => {
		const draft = entry as Record<string, unknown>;

		const type = draft.type;
		if (typeof type !== 'string' || !(QUESTION_TYPES as readonly string[]).includes(type)) {
			throw new FormInputError(`質問${index + 1}: 種類が不正です`);
		}

		const label = typeof draft.label === 'string' ? draft.label.trim() : '';
		if (!label) throw new FormInputError(`質問${index + 1}: 質問文を入力してください`);
		if (label.length > MAX_LABEL) {
			throw new FormInputError(`質問${index + 1}: 質問文は${MAX_LABEL}文字以内です`);
		}

		const helpText = typeof draft.helpText === 'string' ? draft.helpText.trim() : '';
		if (helpText.length > MAX_HELP_TEXT) {
			throw new FormInputError(`質問${index + 1}: 補足は${MAX_HELP_TEXT}文字以内です`);
		}

		return {
			type: type as QuestionType,
			label,
			helpText: helpText || null,
			required: draft.required === true,
			options: parseOptions(draft.options, type as QuestionType, index),
			allowOther: hasOptions(type as QuestionType) && draft.allowOther === true
		};
	});
}

export function parseCreateFormPayload(data: FormData): CreateFormInput {
	const deadline = optionalDate(data.get('deadline'), '締切');
	const closesAt = optionalDate(data.get('closesAt'), '受付終了');

	// closesAt < deadline stays legal: closing before the announced date is a valid choice.
	if (closesAt && closesAt.getTime() <= Date.now()) {
		throw new FormInputError('受付終了は現在より後の日時を指定してください');
	}

	return {
		title: requireText(data.get('title'), 'タイトル', MAX_TITLE),
		description: optionalText(data.get('description'), '説明', MAX_DESCRIPTION),
		targetRoleId: requireText(data.get('targetRoleId'), '対象ロール', MAX_SNOWFLAKE),
		submitScope: pickEnum(data.get('submitScope'), SUBMIT_SCOPES, '提出できる人', 'everyone'),
		visibility: pickEnum(data.get('visibility'), VISIBILITIES, '結果の公開範囲', 'public'),
		deadline,
		closesAt,
		allowEdit: data.get('allowEdit') !== null,
		announcementChannelId: optionalText(
			data.get('announcementChannelId'),
			'告知チャンネル',
			MAX_SNOWFLAKE
		),
		questions: parseQuestions(data.get('questions'))
	};
}

export async function createForm(input: CreateFormInput, createdBy: string): Promise<string> {
	const id = newFormId();

	await db.transaction(async (tx) => {
		await tx.insert(form).values({
			id,
			title: input.title,
			description: input.description,
			targetRoleId: input.targetRoleId,
			submitScope: input.submitScope,
			visibility: input.visibility,
			deadline: input.deadline,
			closesAt: input.closesAt,
			allowEdit: input.allowEdit,
			announcementChannelId: input.announcementChannelId,
			createdBy
		});

		await tx.insert(question).values(
			input.questions.map((draft, index) => ({
				formId: id,
				position: index,
				type: draft.type,
				label: draft.label,
				helpText: draft.helpText,
				required: draft.required,
				options: draft.options,
				allowOther: draft.allowOther
			}))
		);
	});

	return id;
}

export type MemberContext = { roleIds: string[] };

/** Guild membership is the floor; target_role narrows it to the roster the form is aimed at. */
export function canSubmit(target: Pick<Form, 'submitScope' | 'targetRoleId'>, member: MemberContext) {
	if (target.submitScope === 'everyone') return true;
	return member.roleIds.includes(target.targetRoleId);
}

export function closesAtPassed(target: Pick<Form, 'closesAt'>, now = new Date()): boolean {
	return target.closesAt !== null && target.closesAt.getTime() <= now.getTime();
}

export function isClosed(target: Pick<Form, 'closesAt' | 'closedAt'>, now = new Date()): boolean {
	return target.closedAt !== null || closesAtPassed(target, now);
}

export async function activeMember(discordId: string) {
	const [row] = await db
		.select()
		.from(guildMember)
		.where(and(eq(guildMember.discordId, discordId), isNull(guildMember.leftAt)))
		.limit(1);
	return row ?? null;
}

export async function loadForm(formId: string): Promise<Form | null> {
	const [row] = await db.select().from(form).where(eq(form.id, formId)).limit(1);
	return row ?? null;
}

export async function loadQuestions(formId: string): Promise<Question[]> {
	return db
		.select()
		.from(question)
		.where(and(eq(question.formId, formId), isNull(question.deletedAt)))
		.orderBy(asc(question.position), asc(question.id));
}

function requireOption(q: Question, optionId: string) {
	if (!q.options?.some((option) => option.id === optionId)) {
		throw new FormInputError(`「${q.label}」の選択肢が不正です`);
	}
}

function otherText(q: Question, raw: string | null): string {
	if (!q.allowOther) throw new FormInputError(`「${q.label}」の選択肢が不正です`);
	const text = raw?.trim() ?? '';
	if (!text) throw new FormInputError(`「${q.label}」のその他の内容を入力してください`);
	if (text.length > MAX_OTHER_ANSWER) {
		throw new FormInputError(`「${q.label}」のその他は${MAX_OTHER_ANSWER}文字以内で入力してください`);
	}
	return text;
}

// Text typed into "その他" without choosing it is dropped: the client selects it on input, so
// what arrives unchosen was deliberately unchecked afterwards.
function buildAnswer(q: Question, input: AnswerInput): AnswerValue | null {
	const values = input.values.map((value) => value.trim()).filter((value) => value !== '');

	switch (q.type) {
		case 'single': {
			const choice = values[0];
			if (!choice) break;
			if (choice === OTHER_OPTION_ID) return { type: 'single', other: otherText(q, input.other) };
			requireOption(q, choice);
			return { type: 'single', optionId: choice };
		}
		case 'multi': {
			const choices = [...new Set(values)];
			if (choices.length === 0) break;
			const optionIds = choices.filter((choice) => choice !== OTHER_OPTION_ID);
			for (const optionId of optionIds) requireOption(q, optionId);
			return optionIds.length === choices.length
				? { type: 'multi', optionIds }
				: { type: 'multi', optionIds, other: otherText(q, input.other) };
		}
		case 'text': {
			const text = values[0];
			if (!text) break;
			if (text.length > MAX_TEXT_ANSWER) {
				throw new FormInputError(`「${q.label}」は${MAX_TEXT_ANSWER}文字以内で入力してください`);
			}
			return { type: 'text', text };
		}
		case 'date': {
			const date = values[0];
			if (!date) break;
			if (!DATE_PATTERN.test(date) || Number.isNaN(new Date(date).getTime())) {
				throw new FormInputError(`「${q.label}」の日付が不正です`);
			}
			return { type: 'date', date };
		}
	}

	if (q.required) throw new FormInputError(`「${q.label}」は必須です`);
	return null;
}

export type AnswerInput = { values: string[]; other: string | null };

export type AnswerInputs = Map<number, AnswerInput>;

export function collectAnswerInputs(data: FormData, questions: Question[]): AnswerInputs {
	const inputs: AnswerInputs = new Map();
	for (const q of questions) {
		const values = data.getAll(`q_${q.id}`).filter((value) => typeof value === 'string');
		const other = data.get(`q_${q.id}_other`);
		inputs.set(q.id, {
			values: values as string[],
			other: typeof other === 'string' ? other : null
		});
	}
	return inputs;
}

export type SubmitFailure = 'not_found' | 'forbidden' | 'closed' | 'already_submitted';

export type SubmitResult =
	| { ok: true; responseId: number; created: boolean }
	| { ok: false; reason: SubmitFailure };

/**
 * `member` carries the roles Discord reports now, never the mirror's: a removed role must stop a
 * submission at once.
 *
 * The response row is inserted with ON CONFLICT DO NOTHING so that the response_form_user_uq
 * index reports a duplicate as a normal branch instead of a 500.
 */
export async function submitResponse(
	formId: string,
	user: { id: string; discordId: string },
	member: MemberContext,
	inputs: AnswerInputs
): Promise<SubmitResult> {
	const target = await loadForm(formId);
	if (!target) return { ok: false, reason: 'not_found' };
	if (isClosed(target)) return { ok: false, reason: 'closed' };
	if (!canSubmit(target, member)) return { ok: false, reason: 'forbidden' };

	const questions = await loadQuestions(formId);
	const values = questions
		.map((q) => ({
			questionId: q.id,
			value: buildAnswer(q, inputs.get(q.id) ?? { values: [], other: null })
		}))
		.filter((entry): entry is { questionId: number; value: AnswerValue } => entry.value !== null);
	const answers: RevisionAnswers = Object.fromEntries(
		values.map((entry) => [String(entry.questionId), entry.value])
	);

	return db.transaction(async (tx) => {
		// Re-read under a row lock: the check above raced with closeForm, which takes FOR UPDATE.
		const [current] = await tx
			.select({ closedAt: form.closedAt, closesAt: form.closesAt })
			.from(form)
			.where(eq(form.id, formId))
			.for('share')
			.limit(1);
		if (!current) return { ok: false, reason: 'not_found' } as const;
		if (isClosed(current)) return { ok: false, reason: 'closed' } as const;

		const [inserted] = await tx
			.insert(response)
			.values({ formId, userId: user.id, discordId: user.discordId })
			.onConflictDoNothing({ target: [response.formId, response.userId] })
			.returning({ id: response.id });

		let responseId: number;
		const created = inserted !== undefined;

		// No write to the form row here: upgrading this FOR SHARE deadlocks concurrent first
		// responses. A future form editor should tell "has responses" from the response table and
		// lock the form FOR UPDATE, which serializes it against this FOR SHARE.
		if (inserted) {
			responseId = inserted.id;
		} else {
			if (!target.allowEdit) return { ok: false, reason: 'already_submitted' } as const;

			// FOR UPDATE serializes one person's concurrent edits, so each compares against the
			// revision the other committed.
			const [existing] = await tx
				.select({ id: response.id })
				.from(response)
				.where(and(eq(response.formId, formId), eq(response.userId, user.id)))
				.for('update')
				.limit(1);
			if (!existing) return { ok: false, reason: 'already_submitted' } as const;

			responseId = existing.id;

			const [latest] = await tx
				.select({ answers: responseRevision.answers })
				.from(responseRevision)
				.where(eq(responseRevision.responseId, responseId))
				.orderBy(desc(responseRevision.id))
				.limit(1);
			// Resubmitting the same content is not an edit: no revision, and updated_at stays put.
			if (latest && sameAnswers(latest.answers, answers)) {
				return { ok: true, responseId, created } as const;
			}

			// now() rather than new Date(): the transaction's clock, which the revision below uses too.
			await tx.update(response).set({ updatedAt: sql`now()` }).where(eq(response.id, responseId));
			await tx.delete(answer).where(eq(answer.responseId, responseId));
		}

		if (values.length > 0) {
			await tx.insert(answer).values(values.map((entry) => ({ responseId, ...entry })));
		}
		await tx.insert(responseRevision).values({ responseId, answers });

		return { ok: true, responseId, created } as const;
	});
}

export async function loadOwnResponse(formId: string, userId: string) {
	const [row] = await db
		.select()
		.from(response)
		.where(and(eq(response.formId, formId), eq(response.userId, userId)))
		.limit(1);
	if (!row) return null;

	const answers = await db.select().from(answer).where(eq(answer.responseId, row.id));
	return { response: row, answers };
}

/**
 * What the top page shows of a form. Sent to the browser as is, so it must never carry a column
 * the member is not meant to read, such as the frozen rosters or the audience settings.
 */
export type PendingFormSummary = {
	id: string;
	title: string;
	deadline: Date | null;
};

export type SubmittedFormSummary = {
	id: string;
	title: string;
	submittedAt: Date;
	/** More than one means the response was edited. */
	revisionCount: number;
};

export type MemberFormLists = {
	pending: PendingFormSummary[];
	submitted: SubmittedFormSummary[];
};

export async function listFormsForMember(
	member: MemberContext,
	userId: string
): Promise<MemberFormLists> {
	// submitScope and targetRoleId feed canSubmit here and are dropped from what is returned.
	const rows = await db
		.select({
			id: form.id,
			title: form.title,
			deadline: form.deadline,
			closesAt: form.closesAt,
			closedAt: form.closedAt,
			submitScope: form.submitScope,
			targetRoleId: form.targetRoleId
		})
		.from(form)
		.orderBy(desc(form.createdAt));
	const eligible = rows.filter((row) => canSubmit(row, member));
	if (eligible.length === 0) return { pending: [], submitted: [] };

	// Grouped by the primary key, so each response comes back once with its revision count.
	const answered = await db
		.select({
			formId: response.formId,
			submittedAt: response.submittedAt,
			revisionCount: count(responseRevision.id)
		})
		.from(response)
		.leftJoin(responseRevision, eq(responseRevision.responseId, response.id))
		.where(
			and(
				eq(response.userId, userId),
				inArray(
					response.formId,
					eligible.map((row) => row.id)
				)
			)
		)
		.groupBy(response.id);
	const own = new Map(answered.map((row) => [row.formId, row]));

	const pending = eligible
		.filter((row) => !own.has(row.id) && !isClosed(row))
		.sort((a, b) => deadlineRank(a) - deadlineRank(b))
		.map((row) => ({ id: row.id, title: row.title, deadline: row.deadline }));

	const submitted = eligible.flatMap((row) => {
		const entry = own.get(row.id);
		return entry
			? [
					{
						id: row.id,
						title: row.title,
						submittedAt: entry.submittedAt,
						revisionCount: entry.revisionCount
					}
				]
			: [];
	});

	return { pending, submitted };
}

function deadlineRank(row: Pick<Form, 'deadline'>): number {
	return row.deadline ? row.deadline.getTime() : Number.POSITIVE_INFINITY;
}

export type CreatedFormSummary = {
	id: string;
	title: string;
	deadline: Date | null;
	responseCount: number;
};

export function canViewResults(
	target: Pick<Form, 'visibility' | 'deadline'>,
	manage: boolean,
	now = new Date()
): boolean {
	if (manage) return true;
	switch (target.visibility) {
		case 'public':
			return true;
		case 'admin_only':
			return false;
		// A form with no deadline never reaches "after the deadline", so it stays managers-only.
		case 'after_deadline':
			return target.deadline !== null && target.deadline.getTime() <= now.getTime();
	}
}

type NameParts = Pick<GuildMember, 'username' | 'globalName' | 'nickname'>;

/** `||` rather than `??`: an empty nickname must fall through, not win. */
export function memberDisplayName(member: NameParts): string {
	return member.nickname || member.globalName || member.username;
}

type Executor = Pick<typeof db, 'select'>;

/** A person's row in the mirror. Every field is null when a left join found none. */
type RosterFacts = {
	roleIds: string[] | null;
	leftAt: Date | null;
	isBot: boolean | null;
};

/** The JS twin of targetRoster's filter. The two must change together. */
function inRoster(member: RosterFacts | undefined, targetRoleId: string): boolean {
	return (
		member !== undefined &&
		member.roleIds !== null &&
		member.leftAt === null &&
		member.isBot === false &&
		member.roleIds.includes(targetRoleId)
	);
}

/**
 * Whether a responder counts toward the target. Must match targetRoster, or a response would
 * change sides the moment the form closes. Forms closed before final_target_ids existed have no
 * frozen roster and fall back to the mirror.
 */
function targetMatcher(
	target: Pick<Form, 'targetRoleId' | 'closedAt' | 'finalTargetIds'>
): (discordId: string, member: RosterFacts | undefined) => boolean {
	if (target.closedAt !== null && target.finalTargetIds !== null) {
		const frozen = new Set(target.finalTargetIds);
		return (discordId) => frozen.has(discordId);
	}
	return (_, member) => inRoster(member, target.targetRoleId);
}

/** Closing is what fixes the record: after it the non-submitters may not drift with the mirror. */
function frozenNonSubmitters(
	target: Pick<Form, 'closedAt' | 'finalNonSubmitters'>
): FrozenMember[] | null {
	return target.closedAt !== null ? target.finalNonSubmitters : null;
}

/**
 * The roster the form is aimed at. Bots cannot answer and departed members are no longer
 * accountable, so neither may ever surface as a non-submitter.
 */
async function targetRoster(exec: Executor, targetRoleId: string) {
	return exec
		.select({
			discordId: guildMember.discordId,
			username: guildMember.username,
			globalName: guildMember.globalName,
			nickname: guildMember.nickname
		})
		.from(guildMember)
		.where(
			and(
				isNull(guildMember.leftAt),
				eq(guildMember.isBot, false),
				sql`${guildMember.roleIds} @> ${JSON.stringify([targetRoleId])}::jsonb`
			)
		);
}

/** The target roster and its non-submitters, both taken from one read of the mirror. */
export async function rosterStatus(
	exec: Executor,
	target: Pick<Form, 'id' | 'targetRoleId'>
): Promise<{ targetIds: string[]; nonSubmitters: FrozenMember[] }> {
	const roster = await targetRoster(exec, target.targetRoleId);
	const responded = await exec
		.select({ discordId: response.discordId })
		.from(response)
		.where(eq(response.formId, target.id));

	const answered = new Set(responded.map((row) => row.discordId));

	return {
		targetIds: roster.map((row) => row.discordId),
		nonSubmitters: roster
			.filter((row) => !answered.has(row.discordId))
			.map((row) => ({ discordId: row.discordId, displayName: memberDisplayName(row) }))
			.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
	};
}

/** Computed from the mirror as it stands right now, never from a frozen list. */
export async function computeNonSubmitters(
	exec: Executor,
	target: Pick<Form, 'id' | 'targetRoleId'>
): Promise<FrozenMember[]> {
	return (await rosterStatus(exec, target)).nonSubmitters;
}

type ResponderRow = { discordId: string } & {
	[K in keyof NameParts]: NameParts[K] | null;
};

/** The join misses only if the mirror never saw the author; the snowflake still names them. */
function responderName(row: ResponderRow): string {
	const { username, globalName, nickname } = row;
	return username ? memberDisplayName({ username, globalName, nickname }) : row.discordId;
}

/** Sent to anyone canViewResults admits, so it names people but carries no Discord id. */
export type ResultRow = {
	responseId: number;
	displayName: string;
	submittedAt: Date;
	updatedAt: Date;
	/** More than one means the response was edited. */
	revisionCount: number;
	answers: Record<number, AnswerValue>;
};

export type FormResults = {
	/** True when the non-submitter list came from the frozen record instead of the mirror. */
	frozen: boolean;
	targetCount: number;
	submitted: ResultRow[];
	/** Responses from outside the target roster: no target role, a bot, or no longer in the guild. */
	outsiders: ResultRow[];
	/** Display names only, for the same reason as ResultRow. */
	nonSubmitters: string[];
};

export async function loadResults(target: Form): Promise<FormResults> {
	const rows = await db
		.select({
			responseId: response.id,
			discordId: response.discordId,
			submittedAt: response.submittedAt,
			updatedAt: response.updatedAt,
			username: guildMember.username,
			globalName: guildMember.globalName,
			nickname: guildMember.nickname,
			roleIds: guildMember.roleIds,
			leftAt: guildMember.leftAt,
			isBot: guildMember.isBot
		})
		.from(response)
		.leftJoin(guildMember, eq(guildMember.discordId, response.discordId))
		.where(eq(response.formId, target.id))
		.orderBy(asc(response.submittedAt), asc(response.id));

	const responseIds = rows.map((row) => row.responseId);
	const [answers, revisionCounts] = rows.length
		? await Promise.all([
				db.select().from(answer).where(inArray(answer.responseId, responseIds)),
				db
					.select({ responseId: responseRevision.responseId, count: count() })
					.from(responseRevision)
					.where(inArray(responseRevision.responseId, responseIds))
					.groupBy(responseRevision.responseId)
			])
		: [[], []];

	const revisionsOf = new Map(revisionCounts.map((row) => [row.responseId, row.count]));

	const byResponse = new Map<number, Record<number, AnswerValue>>();
	for (const row of answers) {
		let bucket = byResponse.get(row.responseId);
		if (!bucket) {
			bucket = {};
			byResponse.set(row.responseId, bucket);
		}
		bucket[row.questionId] = row.value;
	}

	const isTarget = targetMatcher(target);
	const submitted: ResultRow[] = [];
	const outsiders: ResultRow[] = [];

	for (const row of rows) {
		const entry: ResultRow = {
			responseId: row.responseId,
			displayName: responderName(row),
			submittedAt: row.submittedAt,
			updatedAt: row.updatedAt,
			revisionCount: revisionsOf.get(row.responseId) ?? 0,
			answers: byResponse.get(row.responseId) ?? {}
		};
		if (isTarget(row.discordId, row)) submitted.push(entry);
		else outsiders.push(entry);
	}

	const frozen = frozenNonSubmitters(target);
	const nonSubmitters = frozen ?? (await computeNonSubmitters(db, target));

	return {
		frozen: frozen !== null,
		targetCount: submitted.length + nonSubmitters.length,
		submitted,
		outsiders,
		nonSubmitters: nonSubmitters.map((member) => member.displayName)
	};
}

export type ResponseHistory = {
	displayName: string;
	submittedAt: Date;
	updatedAt: Date;
	/** Newest first. `number` counts from 1 in submission order. */
	revisions: { number: number; createdAt: Date; answers: RevisionAnswers }[];
};

/** Null when the response does not exist or belongs to another form. */
export async function loadResponseHistory(
	formId: string,
	responseId: number
): Promise<ResponseHistory | null> {
	const [row] = await db
		.select({
			discordId: response.discordId,
			submittedAt: response.submittedAt,
			updatedAt: response.updatedAt,
			username: guildMember.username,
			globalName: guildMember.globalName,
			nickname: guildMember.nickname
		})
		.from(response)
		.leftJoin(guildMember, eq(guildMember.discordId, response.discordId))
		.where(and(eq(response.id, responseId), eq(response.formId, formId)))
		.limit(1);
	if (!row) return null;

	const revisions = await db
		.select({ createdAt: responseRevision.createdAt, answers: responseRevision.answers })
		.from(responseRevision)
		.where(eq(responseRevision.responseId, responseId))
		.orderBy(asc(responseRevision.id));

	return {
		displayName: responderName(row),
		submittedAt: row.submittedAt,
		updatedAt: row.updatedAt,
		revisions: revisions.map((revision, index) => ({ number: index + 1, ...revision })).reverse()
	};
}

export type ResponseCounts = { submitted: number; targetCount: number; outsiders: number };

type CountTarget = Pick<
	Form,
	'id' | 'targetRoleId' | 'closedAt' | 'finalTargetIds' | 'finalNonSubmitters'
>;

/**
 * Counts any form as loadResults would, from a single read of the mirror and of every response
 * instead of a query per form.
 */
export async function responseCounter(): Promise<(target: CountTarget) => ResponseCounts> {
	const [members, responses] = await Promise.all([
		db
			.select({
				discordId: guildMember.discordId,
				roleIds: guildMember.roleIds,
				leftAt: guildMember.leftAt,
				isBot: guildMember.isBot
			})
			.from(guildMember),
		db.select({ formId: response.formId, discordId: response.discordId }).from(response)
	]);

	const byId = new Map(members.map((row) => [row.discordId, row]));
	const respondents = new Map<string, string[]>();
	for (const row of responses) {
		const ids = respondents.get(row.formId);
		if (ids) ids.push(row.discordId);
		else respondents.set(row.formId, [row.discordId]);
	}

	return (target) => {
		const ids = respondents.get(target.id) ?? [];
		const isTarget = targetMatcher(target);
		const submitted = ids.filter((id) => isTarget(id, byId.get(id))).length;

		const answered = new Set(ids);
		const nonSubmitters =
			frozenNonSubmitters(target)?.length ??
			members.filter(
				(row) => inRoster(row, target.targetRoleId) && !answered.has(row.discordId)
			).length;

		return {
			submitted,
			targetCount: submitted + nonSubmitters,
			outsiders: ids.length - submitted
		};
	};
}

export type ChoiceTally = {
	questionId: number;
	label: string;
	type: QuestionType;
	options: { id: string; label: string; count: number }[];
	/** Answers given as "その他". Null when the question does not offer it. */
	other: number | null;
};

export function tallyChoices(questions: Question[], rows: ResultRow[]): ChoiceTally[] {
	return questions
		.filter((q) => hasOptions(q.type))
		.map((q) => {
			const counts = new Map((q.options ?? []).map((option) => [option.id, 0]));
			let other = 0;

			for (const row of rows) {
				const value = row.answers[q.id];
				let ids: string[] = [];
				if (value?.type === 'single') {
					if ('other' in value) other++;
					else ids = [value.optionId];
				} else if (value?.type === 'multi') {
					if (value.other !== undefined) other++;
					ids = value.optionIds;
				}
				// Unknown ids are dropped rather than shown as a blank row.
				for (const id of ids) {
					const current = counts.get(id);
					if (current !== undefined) counts.set(id, current + 1);
				}
			}

			return {
				questionId: q.id,
				label: q.label,
				type: q.type,
				options: (q.options ?? []).map((option) => ({
					...option,
					count: counts.get(option.id) ?? 0
				})),
				other: q.allowOther ? other : null
			};
		});
}

export type CloseResult =
	| { ok: true; frozen: number }
	| { ok: false; reason: 'not_found' | 'already_closed' };

/**
 * Closing writes a permanent record, so the mirror is refreshed from Discord first: freezing a
 * stale roster would name the wrong people forever. A Discord failure propagates and the form
 * stays open rather than being frozen on old data.
 */
export async function closeForm(formId: string): Promise<CloseResult> {
	try {
		await syncAllMembers();
	} catch (cause) {
		throw new RosterRefreshError('roster refresh failed before close', { cause });
	}

	return db.transaction(async (tx) => {
		// FOR UPDATE pairs with the FOR SHARE in submitResponse: without it a submission can commit
		// between rosterStatus and the write, landing the same person in both lists.
		const [target] = await tx
			.select()
			.from(form)
			.where(eq(form.id, formId))
			.for('update')
			.limit(1);
		if (!target) return { ok: false, reason: 'not_found' } as const;
		if (target.closedAt) return { ok: false, reason: 'already_closed' } as const;

		const { targetIds, nonSubmitters } = await rosterStatus(tx, target);

		await tx
			.update(form)
			.set({ closedAt: new Date(), finalNonSubmitters: nonSubmitters, finalTargetIds: targetIds })
			.where(and(eq(form.id, formId), isNull(form.closedAt)));

		return { ok: true, frozen: nonSubmitters.length } as const;
	});
}

/**
 * Recovery from a mistaken close. The frozen lists are discarded, not archived. A closes_at that
 * has already passed is cleared, since it would refuse submissions and let the scheduler close the
 * form again; a future one is kept.
 */
export async function reopenForm(formId: string): Promise<boolean> {
	const rows = await db
		.update(form)
		.set({
			closedAt: null,
			finalNonSubmitters: null,
			finalTargetIds: null,
			closesAt: sql`CASE WHEN ${form.closesAt} <= now() THEN NULL ELSE ${form.closesAt} END`
		})
		.where(and(eq(form.id, formId), isNotNull(form.closedAt)))
		.returning({ id: form.id });
	return rows.length > 0;
}

export async function listFormsCreatedBy(userId: string): Promise<CreatedFormSummary[]> {
	return db
		.select({
			id: form.id,
			title: form.title,
			deadline: form.deadline,
			responseCount: count(response.id)
		})
		.from(form)
		.leftJoin(response, eq(response.formId, form.id))
		.where(eq(form.createdBy, userId))
		.groupBy(form.id)
		.orderBy(desc(form.createdAt));
}
