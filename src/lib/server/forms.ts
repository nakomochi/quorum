import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db';
import {
	answer,
	form,
	guildMember,
	newFormId,
	question,
	response,
	type Form,
	type Question,
	type QuestionOption
} from './db/schema';
import { guildId, listGuildRoles, type DiscordRole } from './discord';
import { parseJstLocal } from '../datetime';
import {
	hasOptions,
	MAX_DESCRIPTION,
	MAX_HELP_TEXT,
	MAX_LABEL,
	MAX_OPTION_ID,
	MAX_OPTION_LABEL,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MAX_TEXT_ANSWER,
	MAX_TITLE,
	QUESTION_TYPES,
	SUBMIT_SCOPES,
	VISIBILITIES,
	type AnswerValue,
	type QuestionType,
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

export type QuestionDraft = {
	type: QuestionType;
	label: string;
	helpText: string | null;
	required: boolean;
	options: QuestionOption[] | null;
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
			options: parseOptions(draft.options, type as QuestionType, index)
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
				options: draft.options
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

export function isClosed(target: Pick<Form, 'closesAt' | 'closedAt'>, now = new Date()): boolean {
	if (target.closedAt) return true;
	return target.closesAt !== null && target.closesAt.getTime() <= now.getTime();
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

function buildAnswer(q: Question, raw: string[]): AnswerValue | null {
	const values = raw.map((value) => value.trim()).filter((value) => value !== '');

	switch (q.type) {
		case 'single': {
			const optionId = values[0];
			if (!optionId) break;
			if (!q.options?.some((option) => option.id === optionId)) {
				throw new FormInputError(`「${q.label}」の選択肢が不正です`);
			}
			return { type: 'single', optionId };
		}
		case 'multi': {
			const optionIds = [...new Set(values)];
			if (optionIds.length === 0) break;
			for (const optionId of optionIds) {
				if (!q.options?.some((option) => option.id === optionId)) {
					throw new FormInputError(`「${q.label}」の選択肢が不正です`);
				}
			}
			return { type: 'multi', optionIds };
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

export type AnswerInputs = Map<number, string[]>;

export function collectAnswerInputs(data: FormData, questions: Question[]): AnswerInputs {
	const inputs: AnswerInputs = new Map();
	for (const q of questions) {
		const raw = data.getAll(`q_${q.id}`).filter((value) => typeof value === 'string');
		inputs.set(q.id, raw as string[]);
	}
	return inputs;
}

export type SubmitFailure =
	| 'not_found'
	| 'not_member'
	| 'forbidden'
	| 'closed'
	| 'already_submitted';

export type SubmitResult =
	| { ok: true; responseId: number; created: boolean }
	| { ok: false; reason: SubmitFailure };

/**
 * The response row is inserted with ON CONFLICT DO NOTHING so that the response_form_user_uq
 * index reports a duplicate as a normal branch instead of a 500.
 */
export async function submitResponse(
	formId: string,
	user: { id: string; discordId: string },
	inputs: AnswerInputs
): Promise<SubmitResult> {
	const target = await loadForm(formId);
	if (!target) return { ok: false, reason: 'not_found' };
	if (isClosed(target)) return { ok: false, reason: 'closed' };

	const member = await activeMember(user.discordId);
	if (!member) return { ok: false, reason: 'not_member' };
	if (!canSubmit(target, member)) return { ok: false, reason: 'forbidden' };

	const questions = await loadQuestions(formId);
	const values = questions
		.map((q) => ({ questionId: q.id, value: buildAnswer(q, inputs.get(q.id) ?? []) }))
		.filter((entry): entry is { questionId: number; value: AnswerValue } => entry.value !== null);

	return db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(response)
			.values({ formId, userId: user.id, discordId: user.discordId })
			.onConflictDoNothing({ target: [response.formId, response.userId] })
			.returning({ id: response.id });

		let responseId: number;
		const created = inserted !== undefined;

		if (inserted) {
			responseId = inserted.id;
			// First response freezes the question set; same transaction so a rollback undoes it.
			await tx
				.update(form)
				.set({ structureLockedAt: new Date() })
				.where(and(eq(form.id, formId), isNull(form.structureLockedAt)));
		} else {
			if (!target.allowEdit) return { ok: false, reason: 'already_submitted' } as const;

			const [existing] = await tx
				.select({ id: response.id })
				.from(response)
				.where(and(eq(response.formId, formId), eq(response.userId, user.id)))
				.limit(1);
			if (!existing) return { ok: false, reason: 'already_submitted' } as const;

			responseId = existing.id;
			await tx.update(response).set({ updatedAt: new Date() }).where(eq(response.id, responseId));
			await tx.delete(answer).where(eq(answer.responseId, responseId));
		}

		if (values.length > 0) {
			await tx.insert(answer).values(values.map((entry) => ({ responseId, ...entry })));
		}

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

export async function listFormsForMember(
	member: MemberContext,
	userId: string
): Promise<{ pending: Form[]; submitted: Form[] }> {
	const rows = await db.select().from(form).orderBy(desc(form.createdAt));
	const eligible = rows.filter((row) => canSubmit(row, member));
	if (eligible.length === 0) return { pending: [], submitted: [] };

	const answered = await db
		.select({ formId: response.formId })
		.from(response)
		.where(
			and(
				eq(response.userId, userId),
				inArray(
					response.formId,
					eligible.map((row) => row.id)
				)
			)
		);
	const answeredIds = new Set(answered.map((row) => row.formId));

	const pending = eligible
		.filter((row) => !answeredIds.has(row.id) && !isClosed(row))
		.sort((a, b) => deadlineRank(a) - deadlineRank(b));

	return { pending, submitted: eligible.filter((row) => answeredIds.has(row.id)) };
}

function deadlineRank(row: Form): number {
	return row.deadline ? row.deadline.getTime() : Number.POSITIVE_INFINITY;
}

export type CreatedFormSummary = {
	id: string;
	title: string;
	deadline: Date | null;
	closesAt: Date | null;
	closedAt: Date | null;
	responseCount: number;
};

export async function listFormsCreatedBy(userId: string): Promise<CreatedFormSummary[]> {
	return db
		.select({
			id: form.id,
			title: form.title,
			deadline: form.deadline,
			closesAt: form.closesAt,
			closedAt: form.closedAt,
			responseCount: count(response.id)
		})
		.from(form)
		.leftJoin(response, eq(response.formId, form.id))
		.where(eq(form.createdBy, userId))
		.groupBy(form.id)
		.orderBy(desc(form.createdAt));
}
