import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { formDraft, newFormId, type Form } from './db/schema';
import { loadQuestions } from './forms';
import { draftPayload, questionsField, type FormDraftPayload } from '../form-draft';
import { MAX_TITLE } from '../forms';

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

/** Null for a draft that does not exist or belongs to someone else. */
export async function loadDraft(id: string, userId: string) {
	const [row] = await db
		.select({
			id: formDraft.id,
			version: formDraft.version,
			updatedAt: formDraft.updatedAt,
			payload: formDraft.payload
		})
		.from(formDraft)
		.where(and(eq(formDraft.id, id), eq(formDraft.createdBy, userId)))
		.limit(1);
	return row ?? null;
}

/** What the top page lists. The title is read inside the database so no payload leaves it. */
export type DraftSummary = { id: string; title: string | null; updatedAt: Date };

export async function listDrafts(userId: string): Promise<DraftSummary[]> {
	const rows = await db
		.select({
			id: formDraft.id,
			title: sql<string | null>`${formDraft.payload} -> 'fields' -> 'title' ->> 0`,
			updatedAt: formDraft.updatedAt
		})
		.from(formDraft)
		.where(eq(formDraft.createdBy, userId))
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

/**
 * A new draft holding a published form's content, for its creator or an admin to start from. The
 * deadline and closing time are left out: they are usually past by the time a form is reused.
 * The form itself is only read.
 */
export async function duplicateForm(
	source: Pick<
		Form,
		| 'id'
		| 'title'
		| 'description'
		| 'targetRoleId'
		| 'submitScope'
		| 'visibility'
		| 'allowEdit'
		| 'announcementChannelId'
		| 'announceClose'
	>,
	userId: string
): Promise<SavedDraft> {
	const questions = await loadQuestions(source.id);

	const fields: Record<string, string[]> = {
		title: [copyTitle(source.title)],
		description: [source.description ?? ''],
		targetRoleId: [source.targetRoleId],
		announcementChannelId: [source.announcementChannelId ?? ''],
		announceClose: [source.announceClose ? 'on' : 'off'],
		submitScope: [source.submitScope],
		visibility: [source.visibility],
		deadline: [''],
		closesAt: [''],
		questions: [
			questionsField(
				questions.map((q) => ({
					type: q.type,
					label: q.label,
					helpText: q.helpText ?? '',
					required: q.required,
					options: q.options ?? [],
					allowOther: q.allowOther
				}))
			)
		]
	};
	// Like FormData: an unchecked box has no entry.
	if (source.allowEdit) fields.allowEdit = ['on'];

	return createDraft(userId, draftPayload(fields, false));
}
