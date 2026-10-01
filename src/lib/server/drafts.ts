import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { formDraft, newFormId, type Form, type Question } from './db/schema';
import { loadQuestions } from './forms';
import { toJstLocal } from '../datetime';
import { draftPayload, questionsField, type FormDraftPayload } from '../form-draft';
import { liveOptions, MAX_TITLE } from '../forms';

/**
 * Drafts touch no other row and take no lock: they affect nobody but their author, and the
 * version column is what keeps two tabs of the same author from overwriting each other.
 */

export type SavedDraft = { id: string; version: number; updatedAt: Date };

export async function createDraft(userId: string, payload: unknown): Promise<SavedDraft> {
	const [row] = await db
		.insert(formDraft)
		.values({
			id: newFormId(),
			createdBy: userId,
			payload: payload as FormDraftPayload,
			version: 1,
			updatedAt: sql`now()`
		})
		.returning({ id: formDraft.id, version: formDraft.version, updatedAt: formDraft.updatedAt });
	return row;
}

export type UpdateResult =
	| { ok: true; version: number; updatedAt: Date }
	| { ok: false; reason: 'conflict' | 'not_found' };

/**
 * One conditional statement, so a stale version can never overwrite a newer save. A draft that is
 * gone counts as a conflict too: another tab created the form from it or discarded it. Only a
 * draft that exists and belongs to someone else is reported as not found.
 */
export async function updateDraft(
	id: string,
	userId: string,
	version: number,
	payload: unknown
): Promise<UpdateResult> {
	const [row] = await db
		.update(formDraft)
		.set({
			payload: payload as FormDraftPayload,
			version: sql`${formDraft.version} + 1`,
			updatedAt: sql`now()`
		})
		.where(
			and(eq(formDraft.id, id), eq(formDraft.createdBy, userId), eq(formDraft.version, version))
		)
		.returning({ version: formDraft.version, updatedAt: formDraft.updatedAt });
	if (row) return { ok: true, ...row };

	const [owner] = await db
		.select({ createdBy: formDraft.createdBy })
		.from(formDraft)
		.where(eq(formDraft.id, id))
		.limit(1);
	return { ok: false, reason: owner && owner.createdBy !== userId ? 'not_found' : 'conflict' };
}

export async function deleteDraft(id: string, userId: string): Promise<boolean> {
	const rows = await db
		.delete(formDraft)
		.where(and(eq(formDraft.id, id), eq(formDraft.createdBy, userId)))
		.returning({ id: formDraft.id });
	return rows.length > 0;
}

/**
 * A creation draft of the user's own. Null for a draft that does not exist, belongs to someone
 * else, or edits a published form: the creation page must never turn an edit into a new form.
 */
export async function loadDraft(id: string, userId: string) {
	const [row] = await db
		.select({
			id: formDraft.id,
			version: formDraft.version,
			updatedAt: formDraft.updatedAt,
			payload: formDraft.payload
		})
		.from(formDraft)
		.where(and(eq(formDraft.id, id), eq(formDraft.createdBy, userId), isNull(formDraft.formId)))
		.limit(1);
	return row ?? null;
}

/**
 * What the top page lists: creation drafts only, since an edit is reached from its form. The title
 * is read inside the database so no payload leaves it.
 */
export type DraftSummary = { id: string; title: string | null; updatedAt: Date };

export async function listDrafts(userId: string): Promise<DraftSummary[]> {
	const rows = await db
		.select({
			id: formDraft.id,
			title: sql<string | null>`${formDraft.payload} -> 'fields' -> 'title' ->> 0`,
			updatedAt: formDraft.updatedAt
		})
		.from(formDraft)
		.where(and(eq(formDraft.createdBy, userId), isNull(formDraft.formId)))
		.orderBy(desc(formDraft.updatedAt), desc(formDraft.id));

	return rows.map((row) => ({
		id: row.id,
		title: row.title?.trim().slice(0, MAX_TITLE) || null,
		updatedAt: row.updatedAt
	}));
}

const COPY_SUFFIX = 'のコピー';

/** Clipped so that the copy's title still passes the create action's length check. */
export function copyTitle(title: string): string {
	return title.slice(0, MAX_TITLE - COPY_SUFFIX.length) + COPY_SUFFIX;
}

export type DraftSource = Pick<
	Form,
	| 'title'
	| 'description'
	| 'targetRoleId'
	| 'submitScope'
	| 'visibility'
	| 'deadline'
	| 'closesAt'
	| 'allowEdit'
	| 'announcementChannelId'
	| 'announceClose'
>;

/**
 * A published form as the editor's fields, the way FormData would carry them. A copy is a new form:
 * its questions name no source, and its title and times are left to the caller. Deleted questions
 * and options are not carried.
 */
export function formFields(
	source: DraftSource,
	questions: Question[],
	copy: boolean
): Record<string, string[]> {
	const time = (value: Date | null) => (copy || !value ? '' : toJstLocal(value));
	const fields: Record<string, string[]> = {
		title: [copy ? copyTitle(source.title) : source.title],
		description: [source.description ?? ''],
		targetRoleId: [source.targetRoleId],
		announcementChannelId: [source.announcementChannelId ?? ''],
		announceClose: [source.announceClose ? 'on' : 'off'],
		submitScope: [source.submitScope],
		visibility: [source.visibility],
		deadline: [time(source.deadline)],
		closesAt: [time(source.closesAt)],
		questions: [
			questionsField(
				questions.map((q) => ({
					sourceId: copy ? null : q.id,
					type: q.type,
					label: q.label,
					helpText: q.helpText ?? '',
					required: q.required,
					options: liveOptions(q.options).map(({ id, label }) => ({ id, label })),
					allowOther: q.allowOther
				}))
			)
		]
	};
	// Like FormData: an unchecked box has no entry.
	if (source.allowEdit) fields.allowEdit = ['on'];
	return fields;
}

/**
 * A new draft holding a published form's content, for its creator or an admin to start from. The
 * deadline and closing time are left out: they are usually past by the time a form is reused.
 * The form itself is only read.
 */
export async function duplicateForm(
	source: DraftSource & Pick<Form, 'id'>,
	userId: string
): Promise<SavedDraft> {
	const questions = await loadQuestions(source.id);
	return createDraft(userId, draftPayload(formFields(source, questions, true), false));
}
