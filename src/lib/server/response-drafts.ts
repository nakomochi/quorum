import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { form, responseDraft } from './db/schema';
import { isClosed } from './forms';
import type { RevisionAnswers } from '../forms';

/**
 * Lock order, shared with submitResponse and closeForm: the form row first, then response_draft.
 * A save takes the form FOR SHARE and never touches `response`, so it can wait on a submission
 * or a close but neither of them ever waits on something a save holds before the form row.
 */

export type SaveResponseDraftResult =
	| { ok: true; version: number; updatedAt: Date }
	| { ok: false; reason: 'not_found' | 'closed' | 'conflict' };

/**
 * `version` is the one the page read, 0 when it has none. A version 0 save only creates the row;
 * any other only moves that exact version on. A row that is gone counts as a conflict: another tab
 * submitted the answers or discarded the draft.
 */
export async function saveResponseDraft(
	formId: string,
	userId: string,
	version: number,
	answers: Record<string, unknown>
): Promise<SaveResponseDraftResult> {
	return db.transaction(async (tx) => {
		// FOR SHARE waits out a close in progress (FOR UPDATE), so a save either lands before the
		// close deletes every draft or sees the form closed. Never a draft left after a close.
		const [current] = await tx
			.select({ closedAt: form.closedAt, closesAt: form.closesAt })
			.from(form)
			.where(eq(form.id, formId))
			.for('share')
			.limit(1);
		if (!current) return { ok: false, reason: 'not_found' } as const;
		if (isClosed(current)) return { ok: false, reason: 'closed' } as const;

		const returning = { version: responseDraft.version, updatedAt: responseDraft.updatedAt };
		const stored = answers as RevisionAnswers;

		const [row] =
			version === 0
				? await tx
						.insert(responseDraft)
						.values({ formId, userId, answers: stored, version: 1, updatedAt: sql`now()` })
						.onConflictDoNothing({ target: [responseDraft.formId, responseDraft.userId] })
						.returning(returning)
				: await tx
						.update(responseDraft)
						.set({
							answers: stored,
							version: sql`${responseDraft.version} + 1`,
							updatedAt: sql`now()`
						})
						.where(
							and(
								eq(responseDraft.formId, formId),
								eq(responseDraft.userId, userId),
								eq(responseDraft.version, version)
							)
						)
						.returning(returning);

		return row ? ({ ok: true, ...row } as const) : ({ ok: false, reason: 'conflict' } as const);
	});
}

/** Always the caller's own row. Deleting none is not an error: the goal is that none is left. */
export async function deleteResponseDraft(formId: string, userId: string): Promise<void> {
	await db
		.delete(responseDraft)
		.where(and(eq(responseDraft.formId, formId), eq(responseDraft.userId, userId)));
}

export async function loadResponseDraft(formId: string, userId: string) {
	const [row] = await db
		.select({
			version: responseDraft.version,
			updatedAt: responseDraft.updatedAt,
			answers: responseDraft.answers
		})
		.from(responseDraft)
		.where(and(eq(responseDraft.formId, formId), eq(responseDraft.userId, userId)))
		.limit(1);
	return row ?? null;
}
