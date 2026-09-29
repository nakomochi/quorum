import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { form, reminder, type Form } from './db/schema';
import { messageUrl, postMessage, type CreateMessage } from './discord';
import { isClosed, loadForm, rosterStatus } from './forms';
import { syncAllMembers } from './guild-sync';
import { formatJstWithYear } from '../datetime';

/**
 * allowed_mentions.users is capped at 100 by Discord. Half of that keeps a chunk's mentions
 * (~22 characters each) comfortably inside the 2000-character body limit as well.
 */
const MENTIONS_PER_MESSAGE = 50;

const MAX_CONTENT = 2000;

/** Titles are allowed 200 characters; a reminder only needs enough of one to identify the form. */
const TITLE_IN_MESSAGE = 120;

const NO_DEADLINE = '未設定';

/** Bare `parse: []`: nothing in a body assembled from user-supplied text may ping anyone. */
const SILENT: CreateMessage['allowed_mentions'] = { parse: [] };

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function baseUrl(): string {
	const origin = env.ORIGIN || env.BETTER_AUTH_URL;
	if (!origin) throw new Error('neither ORIGIN nor BETTER_AUTH_URL is set');
	return origin.replace(/\/+$/, '');
}

export function formUrl(formId: string): string {
	return `${baseUrl()}/forms/${formId}`;
}

function announcementContent(target: Form): string {
	const head = `📋 **${truncate(target.title, TITLE_IN_MESSAGE)}**`;
	// With the year even for this year's date: the message stays in the channel past New Year.
	const tail = `締切: ${formatJstWithYear(target.deadline, NO_DEADLINE)}\n${formUrl(target.id)}`;

	// Descriptions may be 4000 characters, twice what a message can carry.
	const room = MAX_CONTENT - head.length - tail.length - 4;
	const body = target.description && room > 0 ? `\n\n${truncate(target.description, room)}` : '';

	return `${head}${body}\n\n${tail}`;
}

function reminderContent(target: Form, discordIds: string[]): string {
	const head = [
		`🔔 **${truncate(target.title, TITLE_IN_MESSAGE)}** が未提出です。回答をお願いします。`,
		`締切: ${formatJstWithYear(target.deadline, NO_DEADLINE)}`,
		formUrl(target.id)
	].join('\n');

	return `${head}\n\n${discordIds.map((id) => `<@${id}>`).join(' ')}`;
}

export type AnnounceResult =
	| { ok: true; messageId: string }
	| { ok: false; reason: 'not_found' | 'no_channel' | 'post_failed' };

/**
 * Posting is deliberately separate from createForm: a Discord outage must not stop a form from
 * being created, so the caller reports the failure and offers this again as a retry.
 */
export async function announceForm(formId: string): Promise<AnnounceResult> {
	const target = await loadForm(formId);
	if (!target) return { ok: false, reason: 'not_found' };
	if (!target.announcementChannelId) return { ok: false, reason: 'no_channel' };

	let message;
	try {
		message = await postMessage(target.announcementChannelId, {
			content: announcementContent(target),
			allowed_mentions: SILENT
		});
	} catch (cause) {
		console.error('announcement post failed', cause);
		return { ok: false, reason: 'post_failed' };
	}

	await db.update(form).set({ announcementMessageId: message.id }).where(eq(form.id, formId));

	return { ok: true, messageId: message.id };
}

export type ReminderOptions = { kind: 'manual' | 'auto'; sentBy: string | null };

export type ReminderResult =
	| { ok: true; targets: number; messages: number }
	| {
			ok: false;
			reason: 'post_failed';
			/** Mentioned by this attempt before the failure. */
			targets: number;
			/** Left for the next send of the same kind. 0 when the failure left no record at all. */
			remaining: number;
	  }
	| {
			ok: false;
			reason:
				| 'not_found'
				| 'closed'
				| 'no_channel'
				| 'no_targets'
				| 'empty_roster'
				| 'already_sent'
				| 'sync_failed';
	  };

type ReminderKind = ReminderOptions['kind'];

/**
 * The latest send of this kind that still has members pending. An automatic one belongs to its
 * deadline; a manual one is continued whatever the deadline.
 */
async function findUnfinished(
	formId: string,
	kind: ReminderKind,
	deadline: Date | null
): Promise<number | null> {
	const [row] = await db
		.select({ id: reminder.id })
		.from(reminder)
		.where(
			and(
				eq(reminder.formId, formId),
				eq(reminder.kind, kind),
				sql`${reminder.pendingDiscordIds} <> '[]'::jsonb`,
				kind === 'auto'
					? deadline
						? eq(reminder.targetDeadline, deadline)
						: isNull(reminder.targetDeadline)
					: undefined
			)
		)
		.orderBy(desc(reminder.id))
		.limit(1);
	return row?.id ?? null;
}

type Progress = { pending: string[]; mentioned: string[] };

/**
 * Reads and rewrites one reminder's progress under its row lock, so that two senders continuing
 * the same reminder never claim the same members. Short on purpose: no Discord call runs inside.
 * Null when the row is gone, or when `change` returns null to delete it.
 */
async function withProgress<T>(
	id: number,
	change: (current: Progress) => { next: Progress | null; value: T }
): Promise<T | null> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ pending: reminder.pendingDiscordIds, mentioned: reminder.targetDiscordIds })
			.from(reminder)
			.where(eq(reminder.id, id))
			.for('update');
		if (!row) return null;

		const { next, value } = change(row);
		if (next === null) {
			await tx.delete(reminder).where(eq(reminder.id, id));
			return null;
		}
		await tx
			.update(reminder)
			.set({ pendingDiscordIds: next.pending, targetDiscordIds: next.mentioned })
			.where(eq(reminder.id, id));
		return value;
	});
}

/** Drops whoever has answered or left since from the pending members. Returns how many are left. */
async function narrowPending(id: number, nonSubmitterIds: string[]): Promise<number> {
	const current = new Set(nonSubmitterIds);
	const left = await withProgress(id, ({ pending, mentioned }) => {
		const kept = pending.filter((discordId) => current.has(discordId));
		return { next: { pending: kept, mentioned }, value: kept.length };
	});
	return left ?? 0;
}

/**
 * Moves the next message's worth of members from pending to mentioned, before anything is posted.
 * A crash between this and the post then leaves them counted as mentioned: a missed mention
 * rather than a second one.
 */
async function claimBatch(id: number): Promise<string[]> {
	const batch = await withProgress(id, ({ pending, mentioned }) => {
		const taken = pending.slice(0, MENTIONS_PER_MESSAGE);
		return {
			next: { pending: pending.slice(taken.length), mentioned: [...mentioned, ...taken] },
			value: taken
		};
	});
	return batch ?? [];
}

/**
 * Puts a batch whose post failed back in front of the pending members. A reminder that has
 * mentioned nobody is deleted instead: left behind, an automatic one would hold the deadline's slot
 * in reminder_auto_once_uq. Returns how many are pending, 0 when the row is gone.
 */
async function releaseBatch(id: number, batch: string[]): Promise<number> {
	const returned = new Set(batch);
	const left = await withProgress(id, ({ pending, mentioned }) => {
		const kept = mentioned.filter((discordId) => !returned.has(discordId));
		const restored = [...batch, ...pending];
		return {
			next: kept.length === 0 ? null : { pending: restored, mentioned: kept },
			value: restored.length
		};
	});
	return left ?? 0;
}

/** Posts the pending members of one reminder, a message at a time, until none are left. */
async function postPending(target: Form, channelId: string, id: number): Promise<ReminderResult> {
	let targets = 0;
	let messages = 0;

	for (;;) {
		const batch = await claimBatch(id);
		if (batch.length === 0) return { ok: true, targets, messages };

		let message;
		try {
			message = await postMessage(channelId, {
				content: reminderContent(target, batch),
				// replied_user: false keeps the reply from notifying the announcement's author, the bot.
				allowed_mentions: { parse: [], users: batch, replied_user: false },
				...(target.announcementMessageId
					? {
							message_reference: {
								message_id: target.announcementMessageId,
								fail_if_not_exists: false
							}
						}
					: {})
			});
		} catch (cause) {
			console.error('reminder post failed', cause);
			const remaining = await releaseBatch(id, batch);
			return { ok: false, reason: 'post_failed', targets, remaining };
		}

		await db
			.update(reminder)
			.set({ messageIds: sql`${reminder.messageIds} || jsonb_build_array(${message.id}::text)` })
			.where(eq(reminder.id, id));
		targets += batch.length;
		messages += 1;
	}
}

export async function sendReminder(
	formId: string,
	options: ReminderOptions
): Promise<ReminderResult> {
	const target = await loadForm(formId);
	if (!target) return { ok: false, reason: 'not_found' };
	// Before the sync below, so a form nobody can answer any more costs no Discord calls.
	if (isClosed(target)) return { ok: false, reason: 'closed' };

	const channelId = target.announcementChannelId;
	if (!channelId) return { ok: false, reason: 'no_channel' };

	// Live roster rather than the mirror: a stale list pings people who already left the guild and
	// silently skips whoever joined since the last sync.
	try {
		await syncAllMembers();
	} catch (cause) {
		console.error('roster refresh failed before reminder', cause);
		return { ok: false, reason: 'sync_failed' };
	}

	const { targetIds, nonSubmitters: targets } = await rosterStatus(db, target);
	const discordIds = targets.map((member) => member.discordId);

	// A send that failed partway is continued, never started over: whoever it mentioned already is
	// not mentioned again.
	const unfinished = await findUnfinished(formId, options.kind, target.deadline);
	if (unfinished !== null) {
		if ((await narrowPending(unfinished, discordIds)) > 0) {
			return postPending(target, channelId, unfinished);
		}
		// Everyone the automatic send had left has answered or left. Its one send for this deadline
		// is done, and the members it mentioned are not mentioned again. A manual one starts afresh.
		if (options.kind === 'auto' && discordIds.length > 0) return { ok: false, reason: 'no_targets' };
	}

	if (targets.length === 0) {
		// An empty row still marks the deadline as handled. Without it the scheduler keeps picking
		// this form up, and every pass refreshes the whole roster from Discord until the deadline.
		if (options.kind === 'auto') {
			await db
				.insert(reminder)
				.values({
					formId,
					kind: 'auto',
					sentBy: null,
					targetDiscordIds: [],
					targetDeadline: target.deadline
				})
				.onConflictDoNothing();
		}
		// An empty roster usually means the target role was deleted or emptied, not that everyone
		// answered, and the two are reported apart for that reason.
		return { ok: false, reason: targetIds.length === 0 ? 'empty_roster' : 'no_targets' };
	}

	/**
	 * Reserved before anything is posted, never after. Inserting afterwards means a crash between
	 * the post and the insert leaves no record, and the next run mentions everyone a second time.
	 * Reserving first also puts the send under reminder_auto_once_uq, so a duplicate automatic
	 * reminder for the same deadline is refused by the database instead of by application logic.
	 */
	const [reserved] = await db
		.insert(reminder)
		.values({
			formId,
			kind: options.kind,
			sentBy: options.sentBy,
			targetDiscordIds: [],
			pendingDiscordIds: discordIds,
			targetDeadline: target.deadline
		})
		.onConflictDoNothing()
		.returning({ id: reminder.id });
	if (!reserved) return { ok: false, reason: 'already_sent' };

	return postPending(target, channelId, reserved.id);
}

export type ReminderLogEntry = {
	id: number;
	kind: 'manual' | 'auto';
	sentAt: Date;
	/** Mentioned so far. */
	targetCount: number;
	/** Not mentioned yet: a send that failed partway, until the next send of its kind continues it. */
	pendingCount: number;
	messageCount: number;
	/** The first message of the send. Null when nothing was posted. */
	url: string | null;
};

/** `channelId` is the form's announcement channel, where every reminder of the form was posted. */
export async function listReminders(
	formId: string,
	channelId: string | null
): Promise<ReminderLogEntry[]> {
	const rows = await db
		.select({
			id: reminder.id,
			kind: reminder.kind,
			sentAt: reminder.sentAt,
			targetCount: sql<number>`jsonb_array_length(${reminder.targetDiscordIds})`,
			pendingCount: sql<number>`jsonb_array_length(${reminder.pendingDiscordIds})`,
			messageCount: sql<number>`jsonb_array_length(${reminder.messageIds})`,
			firstMessageId: sql<string | null>`${reminder.messageIds} ->> 0`
		})
		.from(reminder)
		.where(eq(reminder.formId, formId))
		.orderBy(desc(reminder.sentAt), desc(reminder.id));

	return rows.map(({ firstMessageId, ...entry }) => ({
		...entry,
		url: channelId && firstMessageId ? messageUrl(channelId, firstMessageId) : null
	}));
}
