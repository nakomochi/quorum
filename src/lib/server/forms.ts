import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { db } from './db';
import {
	answer,
	form,
	formDraft,
	guildMember,
	newFormId,
	question,
	response,
	responseDraft,
	responseRevision,
	type Form,
	type FrozenMember,
	type GuildMember,
	type Question,
	type QuestionOption
} from './db/schema';
import { guildId, listGuildChannels, listGuildRoles, type DiscordRole } from './discord';
import { syncAllMembers } from './guild-sync';
import { parseJstLocal } from '../datetime';
import {
	hasOptions,
	liveOptions,
	MAX_DESCRIPTION,
	MAX_FORM_BYTES,
	MAX_HELP_TEXT,
	MAX_LABEL,
	MAX_OPTION_ID,
	MAX_OPTION_LABEL,
	MAX_OPTIONS,
	MAX_OTHER_ANSWER,
	MAX_QUESTIONS,
	MAX_RESPONSE_BYTES,
	MAX_TEXT_ANSWER,
	MAX_TITLE,
	NO_TARGET_ROLE,
	OTHER_OPTION_ID,
	QUESTION_TYPES,
	sameAnswers,
	SUBMIT_SCOPES,
	utf8Bytes,
	VISIBILITIES,
	type AnswerValue,
	type FormField,
	type FormStatus,
	type InputError,
	type InputErrorAt,
	type QuestionType,
	type RevisionAnswers,
	type SubmitScope,
	type Visibility
} from '../forms';

const MAX_SNOWFLAKE = 32;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Rejected user input. Carries a message that is safe to show back on the form, and where. */
export class FormInputError extends Error {
	readonly at: InputErrorAt | null;

	constructor(message: string, at: InputErrorAt | null = null) {
		super(message);
		this.name = 'FormInputError';
		this.at = at;
	}

	/** What an action returns. */
	get detail(): InputError {
		return { message: this.message, at: this.at };
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

/** A posted question. `sourceId` names the published question an edit changes; creation ignores it. */
export type ParsedQuestion = QuestionDraft & { sourceId: number | null };

export type CreateFormInput = {
	title: string;
	description: string | null;
	/** Null for a form aimed at the whole guild. */
	targetRoleId: string | null;
	submitScope: SubmitScope;
	visibility: Visibility;
	deadline: Date | null;
	closesAt: Date | null;
	allowEdit: boolean;
	announcementChannelId: string | null;
	announceClose: boolean;
	questions: QuestionDraft[];
};

export type ParsedForm = Omit<CreateFormInput, 'questions'> & { questions: ParsedQuestion[] };

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

/** The editor's pickers: only what they draw, roles in Discord's order and channels by name. */
export async function editorChoices(): Promise<{
	roles: { id: string; name: string }[];
	channels: { id: string; name: string; category: string | null }[];
}> {
	const [roles, channels] = await Promise.all([selectableRoles(), listGuildChannels()]);
	return {
		roles: roles.map((role) => ({ id: role.id, name: role.name })),
		channels: channels
			.map((channel) => ({ id: channel.id, name: channel.name, category: channel.categoryName }))
			.sort((a, b) => a.name.localeCompare(b.name))
	};
}

/** `name` is the field as posted, and where the error is shown; `label` names it in the message. */
function requireText(data: FormData, name: FormField, label: string, max: number): string {
	const value = data.get(name);
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new FormInputError(`${label}を入力してください`, { field: name });
	if (text.length > max) {
		throw new FormInputError(`${label}は${max}文字以内で入力してください`, { field: name });
	}
	return text;
}

function optionalText(data: FormData, name: FormField, label: string, max: number): string | null {
	const value = data.get(name);
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) return null;
	if (text.length > max) {
		throw new FormInputError(`${label}は${max}文字以内で入力してください`, { field: name });
	}
	return text;
}

function pickEnum<T extends string>(
	data: FormData,
	name: FormField,
	allowed: readonly T[],
	label: string,
	fallback?: T
): T {
	const value = data.get(name);
	if (typeof value !== 'string' || value === '') {
		if (fallback !== undefined) return fallback;
		throw new FormInputError(`${label}を選択してください`, { field: name });
	}
	if (!(allowed as readonly string[]).includes(value)) {
		throw new FormInputError(`${label}の値が不正です`, { field: name });
	}
	return value as T;
}

function optionalDate(data: FormData, name: FormField, label: string): Date | null {
	const value = data.get(name);
	if (typeof value !== 'string' || value.trim() === '') return null;
	const date = parseJstLocal(value);
	if (!date) throw new FormInputError(`${label}の日時が不正です`, { field: name });
	return date;
}

// The messages name no question: they are shown inside the question's own card.
function parseOptions(raw: unknown, type: QuestionType, index: number): QuestionOption[] | null {
	if (!hasOptions(type)) return null;
	const invalid = (message: string) => new FormInputError(message, { question: index });
	if (!Array.isArray(raw) || raw.length === 0) {
		throw invalid('選択肢を1つ以上追加してください');
	}
	if (raw.length > MAX_OPTIONS) throw invalid(`選択肢は${MAX_OPTIONS}個までです`);

	const seen = new Set<string>();
	return raw.map((entry) => {
		const option = entry as Partial<QuestionOption>;
		const id = typeof option.id === 'string' ? option.id.trim() : '';
		const label = typeof option.label === 'string' ? option.label.trim() : '';
		if (!id) throw invalid('選択肢の id がありません');
		if (id === OTHER_OPTION_ID) throw invalid(`選択肢の id「${OTHER_OPTION_ID}」は使えません`);
		if (id.length > MAX_OPTION_ID) throw invalid('選択肢の id が長すぎます');
		if (seen.has(id)) throw invalid('選択肢の id が重複しています');
		if (!label) throw invalid('選択肢のラベルを入力してください');
		if (label.length > MAX_OPTION_LABEL) throw invalid(`選択肢は${MAX_OPTION_LABEL}文字以内です`);
		seen.add(id);
		return { id, label };
	});
}

function parseSourceId(raw: unknown, seen: Set<number>, index: number): number | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0 || seen.has(raw)) {
		throw new FormInputError('質問データが不正です', { question: index });
	}
	seen.add(raw);
	return raw;
}

export function parseQuestions(raw: FormDataEntryValue | null): ParsedQuestion[] {
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

	const sourceIds = new Set<number>();
	return parsed.map((entry, index) => {
		const draft = entry as Record<string, unknown>;
		const invalid = (message: string) => new FormInputError(message, { question: index });
		const sourceId = parseSourceId(draft.sourceId, sourceIds, index);

		const type = draft.type;
		if (typeof type !== 'string' || !(QUESTION_TYPES as readonly string[]).includes(type)) {
			throw invalid('種類が不正です');
		}

		const label = typeof draft.label === 'string' ? draft.label.trim() : '';
		if (!label) throw invalid('質問文を入力してください');
		if (label.length > MAX_LABEL) throw invalid(`質問文は${MAX_LABEL}文字以内です`);

		const helpText = typeof draft.helpText === 'string' ? draft.helpText.trim() : '';
		if (helpText.length > MAX_HELP_TEXT) throw invalid(`補足は${MAX_HELP_TEXT}文字以内です`);

		return {
			sourceId,
			type: type as QuestionType,
			label,
			helpText: helpText || null,
			required: draft.required === true,
			options: parseOptions(draft.options, type as QuestionType, index),
			allowOther: hasOptions(type as QuestionType) && draft.allowOther === true
		};
	});
}

/** What MAX_FORM_BYTES counts. */
function formBytes(data: FormData): number {
	return ['title', 'description', 'questions'].reduce((total, name) => {
		const value = data.get(name);
		return total + (typeof value === 'string' ? utf8Bytes(value) : 0);
	}, 0);
}

/** The editor's submission, for creating a form and for publishing an edit alike. */
export function parseCreateFormPayload(data: FormData): ParsedForm {
	if (formBytes(data) > MAX_FORM_BYTES) {
		throw new FormInputError('フォームが大きすぎます。質問や選択肢を減らしてください');
	}

	const deadline = optionalDate(data, 'deadline', '締切');
	const closesAt = optionalDate(data, 'closesAt', '受付終了');

	// closesAt < deadline stays legal: closing before the announced date is a valid choice.
	if (closesAt && closesAt.getTime() <= Date.now()) {
		throw new FormInputError('受付終了は現在より後の日時を指定してください', {
			field: 'closesAt'
		});
	}

	const role = requireText(data, 'targetRoleId', '対象ロール', MAX_SNOWFLAKE);
	const targetRoleId = role === NO_TARGET_ROLE ? null : role;
	const submitScope = pickEnum(data, 'submitScope', SUBMIT_SCOPES, '提出できる人', 'everyone');

	return {
		title: requireText(data, 'title', 'タイトル', MAX_TITLE),
		description: optionalText(data, 'description', '説明', MAX_DESCRIPTION),
		targetRoleId,
		// Without a role there is nobody to narrow the submitters to, and the editor hides the choice.
		submitScope: targetRoleId === null ? 'everyone' : submitScope,
		visibility: pickEnum(data, 'visibility', VISIBILITIES, '結果の公開範囲', 'public'),
		deadline,
		closesAt,
		allowEdit: data.get('allowEdit') !== null,
		announcementChannelId: optionalText(
			data,
			'announcementChannelId',
			'告知チャンネル',
			MAX_SNOWFLAKE
		),
		// A hidden field rather than the checkbox, which is disabled while no channel is chosen.
		announceClose: data.get('announceClose') !== 'off',
		questions: parseQuestions(data.get('questions'))
	};
}

/**
 * `draftId` names the editor's draft, removed in the same transaction so that a created form never
 * leaves its draft behind and a failed creation never loses it. Someone else's draft is untouched.
 */
export async function createForm(
	input: CreateFormInput,
	createdBy: string,
	draftId: string | null = null
): Promise<string> {
	const id = newFormId();

	await db.transaction(async (tx) => {
		// Only a creation draft: an edit draft names a form and is never turned into a new one.
		if (draftId) {
			await tx
				.delete(formDraft)
				.where(
					and(
						eq(formDraft.id, draftId),
						eq(formDraft.createdBy, createdBy),
						isNull(formDraft.formId)
					)
				);
		}

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
			announceClose: input.announceClose,
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

/**
 * Guild membership is the floor; target_role narrows it to the roster the form is aimed at. A form
 * without a role is open to every member, whatever its submitScope says.
 */
export function canSubmit(
	target: Pick<Form, 'submitScope' | 'targetRoleId'>,
	member: MemberContext
) {
	if (target.submitScope === 'everyone' || target.targetRoleId === null) return true;
	return member.roleIds.includes(target.targetRoleId);
}

/** The SQL twin of canSubmit, for the lists. A test holds the two to the same answers. */
export function canSubmitSql(member: MemberContext): SQL {
	const conditions = [eq(form.submitScope, 'everyone'), isNull(form.targetRoleId)];
	if (member.roleIds.length > 0) conditions.push(inArray(form.targetRoleId, member.roleIds));
	return or(...conditions)!;
}

export function closesAtPassed(target: Pick<Form, 'closesAt'>, now = new Date()): boolean {
	return target.closesAt !== null && target.closesAt.getTime() <= now.getTime();
}

export function isClosed(target: Pick<Form, 'closesAt' | 'closedAt'>, now = new Date()): boolean {
	return target.closedAt !== null || closesAtPassed(target, now);
}

/** The SQL twin of `!isClosed`, judged by the same clock as the caller's. */
export function isOpenSql(now: Date): SQL {
	return and(isNull(form.closedAt), or(isNull(form.closesAt), gt(form.closesAt, now)))!;
}

/** 'ended': closes_at has passed but the close has not run yet, so the rosters are not frozen. */
export function formStatus(
	target: Pick<Form, 'closesAt' | 'closedAt'>,
	now = new Date()
): FormStatus {
	if (target.closedAt !== null) return 'closed';
	return closesAtPassed(target, now) ? 'ended' : 'open';
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

/** The questions a respondent sees, in order. Deleted ones are left out. */
export async function loadQuestions(formId: string): Promise<Question[]> {
	return db
		.select()
		.from(question)
		.where(and(eq(question.formId, formId), isNull(question.deletedAt)))
		.orderBy(asc(question.position), asc(question.id));
}

/**
 * Deleted questions that `revisions` answered, for a history that still shows those answers.
 * Ordered after the live questions by where they stood.
 */
export async function loadAnsweredDeletedQuestions(
	formId: string,
	revisions: { answers: RevisionAnswers }[]
): Promise<Question[]> {
	const ids = [
		...new Set(revisions.flatMap((revision) => Object.keys(revision.answers).map(Number)))
	].filter((id) => Number.isSafeInteger(id));
	if (ids.length === 0) return [];
	return db
		.select()
		.from(question)
		.where(
			and(eq(question.formId, formId), inArray(question.id, ids), isNotNull(question.deletedAt))
		)
		.orderBy(asc(question.position), asc(question.id));
}

// The messages name no question: they are shown inside the question's own card.
const invalidAnswer = (q: Question, message: string) =>
	new FormInputError(message, { questionId: q.id });

function requireOption(q: Question, optionId: string) {
	if (!liveOptions(q.options).some((option) => option.id === optionId)) {
		throw invalidAnswer(q, '選択肢が不正です');
	}
}

function otherText(q: Question, raw: string | null): string {
	if (!q.allowOther) throw invalidAnswer(q, '選択肢が不正です');
	const text = raw?.trim() ?? '';
	if (!text) throw invalidAnswer(q, '「その他」の内容を入力してください');
	if (text.length > MAX_OTHER_ANSWER) {
		throw invalidAnswer(q, `「その他」は${MAX_OTHER_ANSWER}文字以内で入力してください`);
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
				throw invalidAnswer(q, `${MAX_TEXT_ANSWER}文字以内で入力してください`);
			}
			return { type: 'text', text };
		}
		case 'date': {
			const date = values[0];
			if (!date) break;
			if (!DATE_PATTERN.test(date) || Number.isNaN(new Date(date).getTime())) {
				throw invalidAnswer(q, '日付が不正です');
			}
			return { type: 'date', date };
		}
	}

	if (q.required) throw invalidAnswer(q, 'この質問は必須です');
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

/** What MAX_RESPONSE_BYTES counts, "その他" text left unchosen included: it was sent all the same. */
function answerInputBytes(inputs: AnswerInputs): number {
	let total = 0;
	for (const input of inputs.values()) {
		for (const value of input.values) total += utf8Bytes(value);
		if (input.other !== null) total += utf8Bytes(input.other);
	}
	return total;
}

/** 'form_changed': an edit was published after the answers were checked, or after the page was drawn. */
export type SubmitFailure =
	'not_found' | 'forbidden' | 'closed' | 'already_submitted' | 'form_changed';

export type SubmitResult =
	{ ok: true; responseId: number; created: boolean } | { ok: false; reason: SubmitFailure };

/**
 * `member` carries the roles Discord reports now, never the mirror's: a removed role must stop a
 * submission at once.
 *
 * The response row is inserted with ON CONFLICT DO NOTHING so that the response_form_user_uq
 * index reports a duplicate as a normal branch instead of a 500.
 *
 * `version` is the form.version the answer page was drawn with, when it says. The answers are
 * checked against the questions as they are now, and the version they were read at must still
 * hold under the transaction's lock.
 */
export async function submitResponse(
	formId: string,
	user: { id: string; discordId: string },
	member: MemberContext,
	inputs: AnswerInputs,
	version: number | null = null
): Promise<SubmitResult> {
	const target = await loadForm(formId);
	if (!target) return { ok: false, reason: 'not_found' };
	if (isClosed(target)) return { ok: false, reason: 'closed' };
	if (!canSubmit(target, member)) return { ok: false, reason: 'forbidden' };
	if (version !== null && version !== target.version) return { ok: false, reason: 'form_changed' };
	if (answerInputBytes(inputs) > MAX_RESPONSE_BYTES) {
		throw new FormInputError('回答が大きすぎます。入力を短くしてください');
	}

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
		// Re-read under a row lock: the checks above raced with closeForm and with a published edit,
		// both of which take FOR UPDATE.
		const [current] = await tx
			.select({ closedAt: form.closedAt, closesAt: form.closesAt, version: form.version })
			.from(form)
			.where(eq(form.id, formId))
			.for('share')
			.limit(1);
		if (!current) return { ok: false, reason: 'not_found' } as const;
		if (isClosed(current)) return { ok: false, reason: 'closed' } as const;
		if (current.version !== target.version) return { ok: false, reason: 'form_changed' } as const;

		const [inserted] = await tx
			.insert(response)
			.values({ formId, userId: user.id, discordId: user.discordId })
			.onConflictDoNothing({ target: [response.formId, response.userId] })
			.returning({ id: response.id });

		let responseId: number;
		const created = inserted !== undefined;

		// No write to the form row here: upgrading this FOR SHARE deadlocks concurrent first
		// responses. A published edit tells "has responses" from the response table under its
		// FOR UPDATE, which serializes it against this FOR SHARE.
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
		}

		// After the response row's lock, and still after the form row's: the order a draft save
		// (form, then response_draft) keeps too, so the two never wait on each other in a cycle.
		// Deleted in this transaction, so a submission that fails keeps the draft.
		await tx
			.delete(responseDraft)
			.where(and(eq(responseDraft.formId, formId), eq(responseDraft.userId, user.id)));

		if (!created) {
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
			await tx
				.update(response)
				.set({ updatedAt: sql`now()` })
				.where(eq(response.id, responseId));
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

export function canViewResults(
	target: Pick<Form, 'visibility' | 'deadline' | 'closesAt' | 'closedAt'>,
	manage: boolean,
	now = new Date()
): boolean {
	if (manage) return true;
	switch (target.visibility) {
		case 'public':
			return true;
		case 'admin_only':
			return false;
		// Closing opens the results too: a form may have no deadline, or be closed before it.
		case 'after_deadline':
			return (
				(target.deadline !== null && target.deadline.getTime() <= now.getTime()) ||
				isClosed(target, now)
			);
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

/** The JS twin of targetRoster's filter and of countResponses'. The three must change together. */
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
 * frozen roster and fall back to the mirror. Without a role everyone who answered counts.
 */
function targetMatcher(
	target: Pick<Form, 'targetRoleId' | 'closedAt' | 'finalTargetIds'>
): (discordId: string, member: RosterFacts | undefined) => boolean {
	const roleId = target.targetRoleId;
	if (roleId === null) return () => true;
	if (target.closedAt !== null && target.finalTargetIds !== null) {
		const frozen = new Set(target.finalTargetIds);
		return (discordId) => frozen.has(discordId);
	}
	return (_, member) => inRoster(member, roleId);
}

/**
 * Closing is what fixes the record: after it the non-submitters may not drift with the mirror.
 * countResponses repeats this and targetMatcher in SQL.
 */
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

/**
 * The target roster and its non-submitters, both taken from one read of the mirror. A form without
 * a role has no roster, and both are empty.
 */
export async function rosterStatus(
	exec: Executor,
	target: Pick<Form, 'id' | 'targetRoleId'>
): Promise<{ targetIds: string[]; nonSubmitters: FrozenMember[] }> {
	if (target.targetRoleId === null) return { targetIds: [], nonSubmitters: [] };
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
	/** Null for a form without a role: there is no roster to count against. */
	targetCount: number | null;
	/** Every response, when the form has no role. */
	submitted: ResultRow[];
	/**
	 * Responses from outside the target roster: no target role, a bot, or no longer in the guild.
	 * Always empty without a role.
	 */
	outsiders: ResultRow[];
	/** Display names only, for the same reason as ResultRow. Always empty without a role. */
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
				// A deleted question's answers stay in the database and out of the results.
				db
					.select({
						responseId: answer.responseId,
						questionId: answer.questionId,
						value: answer.value
					})
					.from(answer)
					.innerJoin(question, eq(question.id, answer.questionId))
					.where(and(inArray(answer.responseId, responseIds), isNull(question.deletedAt))),
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

	if (target.targetRoleId === null) {
		return { frozen: false, targetCount: null, submitted, outsiders, nonSubmitters: [] };
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

/** `number` counts from 1 in submission order. */
export type Revision = { number: number; createdAt: Date; answers: RevisionAnswers };

export type ResponseHistory = {
	displayName: string;
	submittedAt: Date;
	updatedAt: Date;
	/** Newest first. */
	revisions: Revision[];
};

/**
 * Every revision of one response, newest first. The caller has already tied `responseId` to the
 * form and to whoever may read it: this reads by the id alone.
 */
export async function loadRevisions(responseId: number): Promise<Revision[]> {
	const revisions = await db
		.select({ createdAt: responseRevision.createdAt, answers: responseRevision.answers })
		.from(responseRevision)
		.where(eq(responseRevision.responseId, responseId))
		.orderBy(asc(responseRevision.id));
	return revisions.map((revision, index) => ({ number: index + 1, ...revision })).reverse();
}

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

	return {
		displayName: responderName(row),
		submittedAt: row.submittedAt,
		updatedAt: row.updatedAt,
		revisions: await loadRevisions(responseId)
	};
}

/** `targetCount` is null for a form without a role, as in FormResults. */
export type ResponseCounts = { submitted: number; targetCount: number | null; outsiders: number };

/**
 * The counts of the given forms as loadResults would give them, computed in the database so that
 * neither the mirror nor the responses are read whole. The SQL twin of targetMatcher, inRoster and
 * frozenNonSubmitters; a test holds it to loadResults.
 */
export async function countResponses(formIds: string[]): Promise<Map<string, ResponseCounts>> {
	if (formIds.length === 0) return new Map();

	// Spelled out with table names: drizzle leaves them off the columns of a single-table select,
	// which the subqueries would then read as their own.
	const inRosterSql = sql.raw(`m.left_at IS NULL AND m.is_bot = false
		AND m.role_ids @> jsonb_build_array(f.target_role_id)`);
	const rows = await db
		.select({
			id: sql<string>`f.id`,
			total: sql<number>`(SELECT count(*)::int FROM response r WHERE r.form_id = f.id)`,
			// Null without a role, like targetCount.
			inTarget: sql<number | null>`CASE
				WHEN f.target_role_id IS NULL THEN NULL
				WHEN f.closed_at IS NOT NULL AND f.final_target_ids IS NOT NULL THEN (
					SELECT count(*)::int FROM response r
					WHERE r.form_id = f.id AND f.final_target_ids @> jsonb_build_array(r.discord_id)
				)
				ELSE (
					SELECT count(*)::int FROM response r
					JOIN guild_member m ON m.discord_id = r.discord_id
					WHERE r.form_id = f.id AND ${inRosterSql}
				)
			END`,
			nonSubmitters: sql<number | null>`CASE
				WHEN f.target_role_id IS NULL THEN NULL
				WHEN f.closed_at IS NOT NULL AND f.final_non_submitters IS NOT NULL
					THEN jsonb_array_length(f.final_non_submitters)
				ELSE (
					SELECT count(*)::int FROM guild_member m
					WHERE ${inRosterSql} AND NOT EXISTS (
						SELECT 1 FROM response r WHERE r.form_id = f.id AND r.discord_id = m.discord_id
					)
				)
			END`
		})
		.from(sql`${form} f`)
		.where(sql`f.id IN ${formIds}`);

	return new Map(
		rows.map(({ id, total, inTarget, nonSubmitters }) => [
			id,
			inTarget === null
				? { submitted: total, targetCount: null, outsiders: 0 }
				: {
						submitted: inTarget,
						targetCount: inTarget + (nonSubmitters ?? 0),
						outsiders: total - inTarget
					}
		])
	);
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
			// A deleted option is no candidate any more, and its answers drop out like unknown ids.
			const options = liveOptions(q.options);
			const counts = new Map(options.map((option) => [option.id, 0]));
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
				options: options.map((option) => ({
					id: option.id,
					label: option.label,
					count: counts.get(option.id) ?? 0
				})),
				other: q.allowOther ? other : null
			};
		});
}

export type CloseResult =
	/** `frozen`: the non-submitters fixed by the close. Null for a form without a role. */
	| { ok: true; frozen: number | null }
	| { ok: false; reason: 'not_found' | 'already_closed' | 'not_due' };

/**
 * The time recorded as closed_at. 'closes_at' is the scheduler's: submissions stopped at closes_at,
 * whenever the close runs. It is read under the lock, and a form whose closes_at has not passed
 * by then is left open as 'not_due'.
 */
export type CloseTime = 'now' | 'closes_at';

/**
 * Closing writes a permanent record, so the mirror is refreshed from Discord first: freezing a
 * stale roster would name the wrong people forever. A Discord failure propagates and the form
 * stays open rather than being frozen on old data. The roster is frozen as it stands when the close
 * runs, whatever `at` records. The close is posted to Discord afterwards, by postCloseNotice.
 *
 * A form without a role has no roster: nothing is asked of Discord, and final_target_ids and
 * final_non_submitters stay null.
 */
export async function closeForm(formId: string, at: CloseTime = 'now'): Promise<CloseResult> {
	const [before] = await db
		.select({ targetRoleId: form.targetRoleId })
		.from(form)
		.where(eq(form.id, formId))
		.limit(1);
	if (!before) return { ok: false, reason: 'not_found' };

	const refreshed = before.targetRoleId !== null;
	if (refreshed) {
		try {
			await syncAllMembers();
		} catch (cause) {
			throw new RosterRefreshError('roster refresh failed before close', { cause });
		}
	}

	const result = await db.transaction(async (tx) => {
		// FOR UPDATE pairs with the FOR SHARE in submitResponse: without it a submission can commit
		// between rosterStatus and the write, landing the same person in both lists.
		const [target] = await tx.select().from(form).where(eq(form.id, formId)).for('update').limit(1);
		if (!target) return { ok: false, reason: 'not_found' } as const;
		if (target.closedAt) return { ok: false, reason: 'already_closed' } as const;
		// An edit gave the form a role after the read above, so its roster was not refreshed.
		if (target.targetRoleId !== null && !refreshed) return 'refresh' as const;

		let closedAt = new Date();
		if (at === 'closes_at') {
			if (!target.closesAt || !closesAtPassed(target, closedAt)) {
				return { ok: false, reason: 'not_due' } as const;
			}
			closedAt = target.closesAt;
		}

		const roster = target.targetRoleId === null ? null : await rosterStatus(tx, target);

		await tx
			.update(form)
			.set({
				closedAt,
				finalNonSubmitters: roster?.nonSubmitters ?? null,
				finalTargetIds: roster?.targetIds ?? null
			})
			.where(and(eq(form.id, formId), isNull(form.closedAt)));

		// Under the FOR UPDATE above, which a draft save's FOR SHARE waits for: no draft can be
		// written after this and before the commit. Reopening does not bring them back.
		await tx.delete(responseDraft).where(eq(responseDraft.formId, formId));

		return { ok: true, frozen: roster?.nonSubmitters.length ?? null } as const;
	});

	return result === 'refresh' ? closeForm(formId, at) : result;
}

/** Why reopenForm did nothing, as the results and edit pages say it. */
export const NOT_CLOSED = 'このフォームはまだ確定していません';

/**
 * Recovery from a mistaken close. The frozen lists are discarded, not archived. A closes_at that
 * has already passed is cleared, since it would refuse submissions and let the scheduler close the
 * form again; a future one is kept. The close's post is forgotten too, so the next close posts again.
 */
export async function reopenForm(formId: string): Promise<boolean> {
	const rows = await db
		.update(form)
		.set({
			closedAt: null,
			finalNonSubmitters: null,
			finalTargetIds: null,
			closeNoticeClaimedAt: null,
			closeMessageId: null,
			closesAt: sql`CASE WHEN ${form.closesAt} <= now() THEN NULL ELSE ${form.closesAt} END`
		})
		.where(and(eq(form.id, formId), isNotNull(form.closedAt)))
		.returning({ id: form.id });
	return rows.length > 0;
}
