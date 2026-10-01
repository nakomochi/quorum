import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import {
	form,
	formDraft,
	newFormId,
	question,
	reminder,
	response,
	type Form,
	type Question,
	type QuestionOption
} from './db/schema';
import { formFields } from './drafts';
import { FormInputError, loadQuestions, type ParsedForm } from './forms';
import { draftPayload, type EditorState, type FormDraftPayload } from '../form-draft';
import { AUDIENCE_LOCKED, CHANNEL_LOCKED, liveOptions, TYPE_LOCKED } from '../forms';

/**
 * Editing a published form. The edit is saved as the editor's draft, one per form and person, and
 * published in one transaction that takes the form row FOR UPDATE: that waits out submissions
 * (FOR SHARE) and a close, so "has responses" read under it cannot change before the commit.
 */

/** What an edit may no longer change. */
export type EditLocks = {
	/** Someone has responded: the target role, who may submit and the existing questions' types. */
	answered: boolean;
	/** The announcement or a reminder is in the channel: the channel. */
	posted: boolean;
};

type Executor = Pick<typeof db, 'select'>;

export async function editLocks(
	target: Pick<Form, 'id' | 'announcementMessageId'>,
	exec: Executor = db
): Promise<EditLocks> {
	const [[answered], [reminded]] = await Promise.all([
		exec.select({ id: response.id }).from(response).where(eq(response.formId, target.id)).limit(1),
		exec
			.select({ id: reminder.id })
			.from(reminder)
			.where(and(eq(reminder.formId, target.id), sql`${reminder.messageIds} <> '[]'::jsonb`))
			.limit(1)
	]);
	return {
		answered: answered !== undefined,
		posted: target.announcementMessageId !== null || reminded !== undefined
	};
}

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

export type EditDraft = {
	id: string;
	version: number;
	updatedAt: Date;
	baseVersion: number;
	payload: unknown;
};

async function findEditDraft(formId: string, userId: string): Promise<EditDraft | null> {
	const [row] = await db
		.select({
			id: formDraft.id,
			version: formDraft.version,
			updatedAt: formDraft.updatedAt,
			baseVersion: formDraft.baseVersion,
			payload: formDraft.payload
		})
		.from(formDraft)
		.where(and(eq(formDraft.formId, formId), eq(formDraft.createdBy, userId)))
		.limit(1);
	return row ? { ...row, baseVersion: row.baseVersion ?? 0 } : null;
}

/**
 * True once an edit draft that was never saved, and that an edit published since has made stale, is
 * gone: it holds nothing of the user's, so it is started again rather than reported as a conflict.
 * Deleted rather than rewritten in place, and only while still unsaved: a first save racing this
 * either lands first and keeps the draft, or meets a deleted row and stops as a conflict. Rewriting
 * it at version 1 would let a tab still showing the old content save over the new one unnoticed.
 */
async function replaceUnsaved(draft: EditDraft, target: Form): Promise<boolean> {
	if (draft.version !== 1 || draft.baseVersion === target.version) return false;
	const deleted = await db
		.delete(formDraft)
		.where(and(eq(formDraft.id, draft.id), eq(formDraft.version, 1)))
		.returning({ id: formDraft.id });
	return deleted.length > 0;
}

/**
 * The user's edit of the form: the one saved earlier, or a new one holding the form as it is now.
 * A closesAt equal to the deadline keeps following it, as in a new form nobody has set it on.
 */
export async function openEditDraft(target: Form, userId: string): Promise<EditDraft> {
	const existing = await findEditDraft(target.id, userId);
	if (existing && !(await replaceUnsaved(existing, target))) return existing;

	const questions = await loadQuestions(target.id);
	const payload: FormDraftPayload = draftPayload(
		formFields(target, questions, false),
		!sameTime(target.deadline, target.closesAt)
	);
	// Another tab opening the same edit at once wins the unique index, and its draft is the one read.
	await db
		.insert(formDraft)
		.values({
			id: newFormId(),
			createdBy: userId,
			formId: target.id,
			baseVersion: target.version,
			payload,
			version: 1,
			updatedAt: sql`now()`
		})
		.onConflictDoNothing();

	const created = await findEditDraft(target.id, userId);
	if (!created) throw new Error('edit draft missing right after it was created');
	return created;
}

/**
 * The saved edit with whatever has become locked since it was saved put back as published: a
 * response or a post may arrive after a setting was changed, and a locked field cannot be changed
 * back by hand.
 */
export function withLocksApplied(
	state: EditorState,
	target: Pick<Form, 'targetRoleId' | 'submitScope' | 'announcementChannelId'>,
	questions: Question[],
	locks: EditLocks
): EditorState {
	const byId = new Map(questions.map((q) => [q.id, q]));
	return {
		...state,
		...(locks.answered && { targetRoleId: target.targetRoleId, submitScope: target.submitScope }),
		...(locks.posted && { announcementChannelId: target.announcementChannelId ?? '' }),
		questions: state.questions.map((q) => {
			const source = q.sourceId === null ? undefined : byId.get(q.sourceId);
			if (!locks.answered || !source || source.type === q.type) return q;
			return {
				...q,
				type: source.type,
				options: liveOptions(source.options).map(({ id, label }) => ({ id, label })),
				allowOther: source.allowOther
			};
		})
	};
}

/** Throws the user's edit away, so that the next opening starts from the form as it is. */
export async function discardEditDraft(formId: string, userId: string): Promise<void> {
	await db
		.delete(formDraft)
		.where(and(eq(formDraft.formId, formId), eq(formDraft.createdBy, userId)));
}

/**
 * An option the edit dropped stays in the list marked deleted, so that answers naming it keep its
 * label. One kept is listed again as posted, which also brings a deleted one back.
 */
function mergeOptions(
	stored: QuestionOption[] | null,
	posted: QuestionOption[] | null
): QuestionOption[] | null {
	if (posted === null) return null;
	const kept = new Set(posted.map((option) => option.id));
	const dropped = (stored ?? [])
		.filter((option) => !kept.has(option.id))
		.map((option) => ({ id: option.id, label: option.label, deleted: true as const }));
	return [...posted, ...dropped];
}

/**
 * 'stale': the edit started from an older version than the form has now. `roleChanged` tells the
 * caller to refresh the roster, as creating a form does.
 */
export type PublishResult =
	| { ok: true; roleChanged: boolean }
	| { ok: false; reason: 'not_found' | 'closed' | 'stale' };

/**
 * Publishes an edit that started from `baseVersion`. `input` has been parsed like a new form; the
 * locks are checked here, under the row lock, and a breach throws a FormInputError. Questions and
 * options are never removed, only marked deleted. The user's edit draft goes in the same
 * transaction. Nothing outside the database is waited on.
 */
export async function publishFormEdit(
	formId: string,
	userId: string,
	baseVersion: number,
	input: ParsedForm
): Promise<PublishResult> {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(form)
			.where(eq(form.id, formId))
			.for('update')
			.limit(1);
		if (!current) return { ok: false, reason: 'not_found' } as const;
		if (current.closedAt !== null) return { ok: false, reason: 'closed' } as const;
		if (current.version !== baseVersion) return { ok: false, reason: 'stale' } as const;

		const locks = await editLocks(current, tx);
		if (locks.answered && input.targetRoleId !== current.targetRoleId) {
			throw new FormInputError(AUDIENCE_LOCKED, { field: 'targetRoleId' });
		}
		if (locks.answered && input.submitScope !== current.submitScope) {
			throw new FormInputError(AUDIENCE_LOCKED, { field: 'submitScope' });
		}
		if (locks.posted && input.announcementChannelId !== current.announcementChannelId) {
			throw new FormInputError(CHANNEL_LOCKED, { field: 'announcementChannelId' });
		}

		const stored = await tx
			.select()
			.from(question)
			.where(and(eq(question.formId, formId), isNull(question.deletedAt)));
		const byId = new Map(stored.map((q) => [q.id, q]));
		input.questions.forEach((q, index) => {
			if (q.sourceId === null) return;
			const source = byId.get(q.sourceId);
			if (!source) throw new FormInputError('質問データが不正です', { question: index });
			if (locks.answered && q.type !== source.type) {
				throw new FormInputError(TYPE_LOCKED, { question: index });
			}
		});

		await tx
			.update(form)
			.set({
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
				version: sql`${form.version} + 1`
			})
			.where(eq(form.id, formId));

		const added = [];
		const kept = new Set<number>();
		for (const [position, q] of input.questions.entries()) {
			const values = {
				position,
				type: q.type,
				label: q.label,
				helpText: q.helpText,
				required: q.required,
				allowOther: q.allowOther
			};
			if (q.sourceId === null) {
				added.push({ ...values, formId, options: q.options });
				continue;
			}
			kept.add(q.sourceId);
			await tx
				.update(question)
				.set({ ...values, options: mergeOptions(byId.get(q.sourceId)?.options ?? null, q.options) })
				.where(eq(question.id, q.sourceId));
		}
		if (added.length > 0) await tx.insert(question).values(added);

		const removed = stored.filter((q) => !kept.has(q.id)).map((q) => q.id);
		if (removed.length > 0) {
			await tx.update(question).set({ deletedAt: sql`now()` }).where(inArray(question.id, removed));
		}

		await tx
			.delete(formDraft)
			.where(and(eq(formDraft.formId, formId), eq(formDraft.createdBy, userId)));

		return { ok: true, roleChanged: input.targetRoleId !== current.targetRoleId } as const;
	});
}
