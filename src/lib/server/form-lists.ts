import { and, count, desc, eq, notExists, sql } from 'drizzle-orm';
import { db } from './db';
import { form, response, responseRevision } from './db/schema';
import {
	canSubmitSql,
	countResponses,
	formStatus,
	isClosed,
	isOpenSql,
	type MemberContext,
	type ResponseCounts
} from './forms';
import { fetchPage, keyset, readPageRequest, sortKey, type Page, type PageRequest } from './keyset';
import type { FormStatus, SubmitScope } from '../forms';

/**
 * The lists of forms: the top page's, their own pages', and the admin page's. What they return is
 * sent to the browser as is, so it must never carry a column the viewer is not meant to read, such
 * as the frozen rosters or the audience settings.
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

export type CreatedFormSummary = {
	id: string;
	title: string;
	deadline: Date | null;
	responseCount: number;
	status: FormStatus;
};

/** For the admin page, which turns the role id into its name before sending anything. */
export type AdminFormSummary = ResponseCounts & {
	id: string;
	title: string;
	targetRoleId: string | null;
	submitScope: SubmitScope;
	deadline: Date | null;
	closed: boolean;
};

export type ListPage<Row> = Page<Row> & { total: number };

// The ids the cursors carry: form ids are nanoids, response ids an integer identity.
const isFormId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const isResponseId = (id: string) => /^\d{1,10}$/.test(id) && Number(id) <= 2147483647;

export const submittedPageRequest = (url: URL) => readPageRequest(url.searchParams, isResponseId);
export const formsPageRequest = (url: URL) => readPageRequest(url.searchParams, isFormId);

/** Every form the member may answer, has not answered, and that still takes answers. */
export async function listPendingForms(
	member: MemberContext,
	userId: string,
	now = new Date()
): Promise<PendingFormSummary[]> {
	return db
		.select({ id: form.id, title: form.title, deadline: form.deadline })
		.from(form)
		.where(
			and(
				canSubmitSql(member),
				isOpenSql(now),
				notExists(
					db
						.select({ answered: sql`1` })
						.from(response)
						.where(and(eq(response.formId, form.id), eq(response.userId, userId)))
				)
			)
		)
		// Nearest deadline first, then the newest.
		.orderBy(sql`${form.deadline} ASC NULLS LAST`, desc(form.createdAt), desc(form.id));
}

/**
 * The member's own responses, newest first by when each was first sent, to the forms they may
 * still answer: a form whose role they lost drops out, as it does from the pending list.
 */
export async function pageSubmittedForms(
	member: MemberContext,
	userId: string,
	request: PageRequest,
	size: number
): Promise<ListPage<SubmittedFormSummary>> {
	const mine = and(eq(response.userId, userId), canSubmitSql(member));

	const [page, [{ total }]] = await Promise.all([
		fetchPage(request, size, (at, limit) => {
			const { where, orderBy } = keyset(response.submittedAt, response.id, at);
			return db
				.select({
					id: form.id,
					title: form.title,
					submittedAt: response.submittedAt,
					revisionCount: db.$count(responseRevision, eq(responseRevision.responseId, response.id)),
					sortKey: sortKey(response.submittedAt),
					key: response.id
				})
				.from(response)
				.innerJoin(form, eq(form.id, response.formId))
				.where(and(mine, where))
				.orderBy(...orderBy)
				.limit(limit);
		}),
		db.select({ total: count() }).from(response).innerJoin(form, eq(form.id, response.formId)).where(mine)
	]);

	return {
		...page,
		rows: page.rows.map(({ id, title, submittedAt, revisionCount }) => ({
			id,
			title,
			submittedAt,
			revisionCount
		})),
		total
	};
}

export async function pageCreatedForms(
	userId: string,
	request: PageRequest,
	size: number
): Promise<ListPage<CreatedFormSummary>> {
	const mine = eq(form.createdBy, userId);

	const [page, total] = await Promise.all([
		fetchPage(request, size, (at, limit) => {
			const { where, orderBy } = keyset(form.createdAt, form.id, at);
			return db
				.select({
					id: form.id,
					title: form.title,
					deadline: form.deadline,
					closesAt: form.closesAt,
					closedAt: form.closedAt,
					responseCount: db.$count(response, eq(response.formId, form.id)),
					sortKey: sortKey(form.createdAt),
					key: form.id
				})
				.from(form)
				.where(and(mine, where))
				.orderBy(...orderBy)
				.limit(limit);
		}),
		db.$count(form, mine)
	]);

	// The two times decide the status and are not sent on.
	const now = new Date();
	return {
		...page,
		rows: page.rows.map(({ id, title, deadline, responseCount, closesAt, closedAt }) => ({
			id,
			title,
			deadline,
			responseCount,
			status: formStatus({ closesAt, closedAt }, now)
		})),
		total
	};
}

/** Every form, newest first, counted only for the page shown. */
export async function pageAllForms(
	request: PageRequest,
	size: number
): Promise<ListPage<AdminFormSummary>> {
	const [page, total] = await Promise.all([
		fetchPage(request, size, (at, limit) => {
			const { where, orderBy } = keyset(form.createdAt, form.id, at);
			return db
				.select({
					id: form.id,
					title: form.title,
					targetRoleId: form.targetRoleId,
					submitScope: form.submitScope,
					deadline: form.deadline,
					closesAt: form.closesAt,
					closedAt: form.closedAt,
					sortKey: sortKey(form.createdAt),
					key: form.id
				})
				.from(form)
				.where(where)
				.orderBy(...orderBy)
				.limit(limit);
		}),
		db.$count(form)
	]);

	const counts = await countResponses(page.rows.map((row) => row.id));
	const now = new Date();
	return {
		...page,
		rows: page.rows.map((row) => ({
			id: row.id,
			title: row.title,
			targetRoleId: row.targetRoleId,
			submitScope: row.submitScope,
			deadline: row.deadline,
			closed: isClosed(row, now),
			// Present for every row: the counts read the same forms by id.
			...counts.get(row.id)!
		})),
		total
	};
}
