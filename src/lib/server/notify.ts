import { desc, eq, sql } from 'drizzle-orm';
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
			reason:
				| 'not_found'
				| 'closed'
				| 'no_channel'
				| 'no_targets'
				| 'empty_roster'
				| 'already_sent'
				| 'sync_failed'
				| 'post_failed';
	  };

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

	const discordIds = targets.map((member) => member.discordId);

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
			targetDiscordIds: discordIds,
			targetDeadline: target.deadline
		})
		.onConflictDoNothing()
		.returning({ id: reminder.id });
	if (!reserved) return { ok: false, reason: 'already_sent' };

	const messageIds: string[] = [];

	try {
		for (let i = 0; i < discordIds.length; i += MENTIONS_PER_MESSAGE) {
			const batch = discordIds.slice(i, i + MENTIONS_PER_MESSAGE);
			const message = await postMessage(channelId, {
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
			messageIds.push(message.id);
		}
	} catch (cause) {
		console.error('reminder post failed', cause);
		// Releases the reservation. Left behind, it would block every later attempt at this deadline
		// forever. A partially posted send is therefore repeated in full on the next attempt.
		await db.delete(reminder).where(eq(reminder.id, reserved.id));
		return { ok: false, reason: 'post_failed' };
	}

	await db.update(reminder).set({ messageIds }).where(eq(reminder.id, reserved.id));

	return { ok: true, targets: targets.length, messages: messageIds.length };
}

export type ReminderLogEntry = {
	id: number;
	kind: 'manual' | 'auto';
	sentAt: Date;
	targetCount: number;
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
