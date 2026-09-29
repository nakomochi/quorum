import { and, eq, gt, isNotNull, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import { db } from './db';
import { form, reminder } from './db/schema';
import { closeForm } from './forms';
import { syncAllMembers, type SyncAllResult } from './guild-sync';
import { postCloseNotice, sendReminder } from './notify';

const REMINDER_LEAD = sql`interval '24 hours'`;

/** How long after a close its post is still retried. */
const CLOSE_NOTICE_RETRY = sql`interval '24 hours'`;

export type TickResult = {
	reminded: string[];
	closed: string[];
	/** Forms whose close was posted to Discord by this pass. */
	closePosted: string[];
	/** Forms whose scheduled action did not happen. Every entry is also logged. */
	failed: string[];
};

/**
 * A range rather than an equality: a form is due from the moment its deadline comes within the
 * lead time and stays due until the deadline passes. A window missed while the process was down
 * is therefore picked up by the next tick instead of being skipped forever.
 */
async function dueForReminder(): Promise<string[]> {
	const rows = await db
		.select({ id: form.id })
		.from(form)
		.where(
			and(
				isNull(form.closedAt),
				// A passed closes_at is closed already, even before the close pass below records it.
				or(isNull(form.closesAt), gt(form.closesAt, sql`now()`)),
				// Load-bearing: reminder_auto_once_uq is keyed on target_deadline, and Postgres treats
				// NULLs there as distinct, so a form without a deadline would be reminded every tick.
				isNotNull(form.deadline),
				lte(form.deadline, sql`now() + ${REMINDER_LEAD}`),
				gt(form.deadline, sql`now()`),
				// Nowhere to post; sendReminder would only refuse it.
				isNotNull(form.announcementChannelId),
				// A send that failed partway still has members pending and stays due until they are sent.
				notExists(
					db
						.select({ sent: sql`1` })
						.from(reminder)
						.where(
							and(
								eq(reminder.formId, form.id),
								eq(reminder.kind, 'auto'),
								eq(reminder.targetDeadline, form.deadline),
								sql`${reminder.pendingDiscordIds} = '[]'::jsonb`
							)
						)
				)
			)
		);

	return rows.map((row) => row.id);
}

async function dueForClose(): Promise<string[]> {
	const rows = await db
		.select({ id: form.id })
		.from(form)
		.where(and(isNull(form.closedAt), isNotNull(form.closesAt), lte(form.closesAt, sql`now()`)));

	return rows.map((row) => row.id);
}

/**
 * Closes whose post is still owed: closed by this pass, or by hand while Discord failed. Bounded so
 * that a channel refusing every post is not retried forever.
 */
async function dueForCloseNotice(): Promise<string[]> {
	const rows = await db
		.select({ id: form.id })
		.from(form)
		.where(
			and(
				isNotNull(form.closedAt),
				gt(form.closedAt, sql`now() - ${CLOSE_NOTICE_RETRY}`),
				eq(form.announceClose, true),
				isNotNull(form.announcementChannelId),
				isNull(form.closeNoticeClaimedAt)
			)
		);

	return rows.map((row) => row.id);
}

/** One pass over every schedule. Throws only if a query itself fails. */
export async function runTick(): Promise<TickResult> {
	const result: TickResult = { reminded: [], closed: [], closePosted: [], failed: [] };

	// Per-form try/catch throughout: one form that Discord rejects must not hold up the rest.
	for (const id of await dueForReminder()) {
		try {
			const sent = await sendReminder(id, { kind: 'auto', sentBy: null });
			if (sent.ok) {
				result.reminded.push(id);
			} else if (
				sent.reason !== 'no_targets' &&
				sent.reason !== 'empty_roster' &&
				sent.reason !== 'closed'
			) {
				// no_targets and empty_roster are not failures: nobody is left to mention, and
				// sendReminder has already recorded the deadline as handled. closed only reaches here
				// by racing a close.
				result.failed.push(id);
				// A failed post leaves either no record or the unsent members pending, and the next tick
				// sends them on its own. Logging is the only thing that keeps a Discord outage from
				// failing in silence.
				console.warn(`auto reminder not sent for ${id}: ${sent.reason}`);
			}
		} catch (cause) {
			result.failed.push(id);
			console.error(`auto reminder failed for ${id}`, cause);
		}
	}

	for (const id of await dueForClose()) {
		try {
			// closed_at records closes_at, when submissions actually stopped, not when this pass ran.
			const closed = await closeForm(id, 'closes_at');
			if (closed.ok) {
				result.closed.push(id);
			} else if (closed.reason !== 'not_due') {
				// not_due is not a failure: a close and reopen by hand, which clears a passed closes_at,
				// got in between the query above and this close.
				result.failed.push(id);
				console.warn(`auto close not applied to ${id}: ${closed.reason}`);
			}
		} catch (cause) {
			result.failed.push(id);
			console.error(`auto close failed for ${id}`, cause);
		}
	}

	// After the closes above, so that a form closed by this pass is posted by it too.
	for (const id of await dueForCloseNotice()) {
		try {
			const posted = await postCloseNotice(id);
			if (posted.ok) {
				result.closePosted.push(id);
			} else if (posted.reason === 'post_failed') {
				// The claim is released, and the next pass tries again. skipped is not a failure: a
				// close by hand posting its own, or a reopen, got in between.
				result.failed.push(id);
				console.warn(`close notice not posted for ${id}: ${posted.reason}`);
			}
		} catch (cause) {
			result.failed.push(id);
			console.error(`close notice failed for ${id}`, cause);
		}
	}

	return result;
}

const CRON_JOBS = {
	tick: runTick,
	'sync-members': syncAllMembers
} satisfies Record<string, () => Promise<TickResult | SyncAllResult>>;

export type CronJob = keyof typeof CRON_JOBS;

export function isCronJob(name: string): name is CronJob {
	return Object.hasOwn(CRON_JOBS, name);
}

/**
 * Per job rather than one flag: the hourly sync's schedule always coincides with a tick, so a
 * shared flag would refuse one of them every hour. Running them side by side is already the norm,
 * since every close and reminder inside a tick runs the same sync.
 */
const running = new Set<CronJob>();

/**
 * Null when the previous run of the same job is still in flight. A tick can outlast its one-minute
 * interval because every close and reminder refreshes the whole roster from Discord, and two
 * overlapping passes would work the same forms twice. Errors propagate to the caller.
 */
export async function runCronJob(job: CronJob): Promise<TickResult | SyncAllResult | null> {
	if (running.has(job)) return null;

	running.add(job);
	try {
		return await CRON_JOBS[job]();
	} finally {
		running.delete(job);
	}
}
