import { and, eq, gt, isNotNull, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import { db } from './db';
import { form, reminder } from './db/schema';
import { closeForm } from './forms';
import { syncAllMembers, type SyncAllResult } from './guild-sync';
import { sendReminder } from './notify';

const REMINDER_LEAD = sql`interval '24 hours'`;

export type TickResult = {
	reminded: string[];
	closed: string[];
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
				notExists(
					db
						.select({ sent: sql`1` })
						.from(reminder)
						.where(
							and(
								eq(reminder.formId, form.id),
								eq(reminder.kind, 'auto'),
								eq(reminder.targetDeadline, form.deadline)
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

/** One pass over both schedules. Throws only if a query itself fails. */
export async function runTick(): Promise<TickResult> {
	const result: TickResult = { reminded: [], closed: [], failed: [] };

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
				// sendReminder drops its reservation when a post fails, so the next tick retries on its
				// own. Logging is the only thing that keeps a Discord outage from failing in silence.
				console.warn(`auto reminder not sent for ${id}: ${sent.reason}`);
			}
		} catch (cause) {
			result.failed.push(id);
			console.error(`auto reminder failed for ${id}`, cause);
		}
	}

	for (const id of await dueForClose()) {
		try {
			const closed = await closeForm(id);
			if (closed.ok) {
				result.closed.push(id);
			} else {
				result.failed.push(id);
				console.warn(`auto close not applied to ${id}: ${closed.reason}`);
			}
		} catch (cause) {
			result.failed.push(id);
			console.error(`auto close failed for ${id}`, cause);
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
 * Per job rather than one flag: the daily sync's schedule always coincides with a tick, so a
 * shared flag would refuse one of them every day. Running them side by side is already the norm,
 * since every close and reminder inside a tick runs the same sync.
 */
const running = new Set<CronJob>();

/**
 * Null when the previous run of the same job is still in flight. A tick can outlast the cron
 * interval because closing refreshes the whole roster from Discord, and two overlapping passes
 * would work the same forms twice. Errors propagate to the caller.
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
