import { and, eq, gt, isNotNull, isNull, lte, notExists, sql } from 'drizzle-orm';
import { db } from './db';
import { form, reminder } from './db/schema';
import { closeForm } from './forms';
import { sendReminder } from './notify';

/**
 * Both schedules are keyed on a deadline and a closing time, neither of which is meaningful to
 * the minute, so a coarse interval costs nothing.
 */
const TICK_INTERVAL_MS = 5 * 60_000;

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

/** One pass over both schedules. Throws only if a query itself fails; see tickOnce. */
export async function runTick(): Promise<TickResult> {
	const result: TickResult = { reminded: [], closed: [], failed: [] };

	// Per-form try/catch throughout: one form that Discord rejects must not hold up the rest.
	for (const id of await dueForReminder()) {
		try {
			const sent = await sendReminder(id, { kind: 'auto', sentBy: null });
			if (sent.ok) {
				result.reminded.push(id);
			} else {
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

let running = false;

/**
 * Serialized entry point. A pass can outlast the interval because closing refreshes the whole
 * roster from Discord, and two overlapping passes would work the same forms twice.
 * Null means no pass completed: one was already in flight, or the pass itself threw.
 */
export async function tickOnce(): Promise<TickResult | null> {
	if (running) {
		console.warn('scheduler tick skipped: the previous one is still running');
		return null;
	}

	running = true;
	try {
		return await runTick();
	} catch (cause) {
		// The two queries above are outside every per-form catch, and an unhandled rejection raised
		// from a setInterval callback takes the process down.
		console.error('scheduler tick failed', cause);
		return null;
	} finally {
		running = false;
	}
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
	if (timer) return;
	// Deliberately no pass on boot: the process restarts on every deploy, and a crash loop would
	// turn that into a burst of Discord calls.
	timer = setInterval(tickOnce, TICK_INTERVAL_MS);
}
