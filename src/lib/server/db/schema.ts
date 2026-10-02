import { nanoid } from 'nanoid';
import { sql } from 'drizzle-orm';
import type { FormDraftPayload } from '../../form-draft';
import type { AnswerValue, RevisionAnswers } from '../../forms';
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';

export const questionType = pgEnum('question_type', ['single', 'multi', 'text', 'date']);
export const formVisibility = pgEnum('form_visibility', ['public', 'admin_only', 'after_deadline']);
export const submitScope = pgEnum('submit_scope', ['everyone', 'target_role']);
export const reminderKind = pgEnum('reminder_kind', ['manual', 'auto']);

/**
 * `deleted` marks an option removed by an edit after the form was published. It stays in the list
 * so that answers naming it keep their label, and is never offered or counted again.
 */
export type QuestionOption = { id: string; label: string; deleted?: true };

export type FrozenMember = { discordId: string; displayName: string };

export const FORM_ID_LENGTH = 12;

export const newFormId = () => nanoid(FORM_ID_LENGTH);

// --- Better Auth core tables ---

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	// Discord snowflake, denormalized from the OAuth profile so guild joins are unnecessary.
	discordId: text('discord_id').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
});

export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [index('session_user_id_idx').on(t.userId)]
);

export const account = pgTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [index('account_user_id_idx').on(t.userId)]
);

export const verification = pgTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [index('verification_identifier_idx').on(t.identifier)]
);

// --- Application tables ---

/**
 * Mirror of the Discord guild member list. Primary read path for display names
 * and role membership, so the UI never has to hit the Discord API inline.
 */
export const guildMember = pgTable('guild_member', {
	discordId: text('discord_id').primaryKey(),
	username: text('username').notNull(),
	globalName: text('global_name'),
	nickname: text('nickname'),
	// The account's avatar; guild_avatar_hash is the server profile's, set only when it differs.
	avatarHash: text('avatar_hash'),
	guildAvatarHash: text('guild_avatar_hash'),
	roleIds: jsonb('role_ids').$type<string[]>().notNull().default([]),
	isBot: boolean('is_bot').notNull().default(false),
	joinedAt: timestamp('joined_at', { withTimezone: true }),
	// Soft delete: keeps display names resolvable for answers left by former members.
	leftAt: timestamp('left_at', { withTimezone: true }),
	syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow()
});

/** When the last full sync succeeded, and the guild owner and role permissions as of then. */
export const guildSync = pgTable(
	'guild_sync',
	{
		id: integer('id').primaryKey().default(1),
		lastFullSyncAt: timestamp('last_full_sync_at', { withTimezone: true }).notNull(),
		ownerId: text('owner_id').notNull(),
		// permissions stays a decimal string: the bitfield is parsed with BigInt at read time.
		roles: jsonb('roles').$type<{ id: string; permissions: string }[]>().notNull()
	},
	(t) => [check('guild_sync_single_row', sql`${t.id} = 1`)]
);

export const form = pgTable(
	'form',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newFormId()),
		title: text('title').notNull(),
		description: text('description'),
		// Role that defines the roster and the mention target. Null for a form aimed at the whole
		// guild, which has no roster: anyone may submit, and nobody is mentioned.
		targetRoleId: text('target_role_id'),
		// Who may submit. Deliberately separate from the mention target. Always 'everyone' without a role.
		submitScope: submitScope('submit_scope').notNull().default('everyone'),
		visibility: formVisibility('visibility').notNull().default('public'),
		// Announced deadline (may differ from closes_at).
		deadline: timestamp('deadline', { withTimezone: true }),
		// Hard stop: submissions are refused and the form is frozen. Null means never auto-close.
		closesAt: timestamp('closes_at', { withTimezone: true }),
		allowEdit: boolean('allow_edit').notNull().default(true),
		announcementChannelId: text('announcement_channel_id'),
		announcementMessageId: text('announcement_message_id'),
		/**
		 * The text last posted or edited into the announcement. Null when that is unknown (announced
		 * before this was recorded): not shown as stale, and edited and recorded by the next refresh.
		 */
		announcedContent: text('announced_content'),
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		finalNonSubmitters: jsonb('final_non_submitters').$type<FrozenMember[]>(),
		// The target roster at close, so a later role change cannot move a response in or out of it.
		finalTargetIds: jsonb('final_target_ids').$type<string[]>(),
		// Whether a close is posted to the announcement channel.
		announceClose: boolean('announce_close').notNull().default(true),
		/**
		 * Claimed before the close is posted, so that a crash between the two leaves the post missed
		 * rather than sent twice. Cleared again by a failed post and by reopening.
		 */
		closeNoticeClaimedAt: timestamp('close_notice_claimed_at', { withTimezone: true }),
		// Set once the post has gone through.
		closeMessageId: text('close_message_id'),
		// Moved on by every published edit. A submission validated against an older one is refused.
		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		index('form_deadline_idx').on(t.deadline),
		index('form_closes_at_idx').on(t.closesAt),
		index('form_target_role_id_idx').on(t.targetRoleId)
	]
);

export const question = pgTable(
	'question',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		formId: text('form_id')
			.notNull()
			.references(() => form.id, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		type: questionType('type').notNull(),
		label: text('label').notNull(),
		helpText: text('help_text'),
		required: boolean('required').notNull().default(false),
		// single/multi only. Options carry stable ids so answers survive relabeling.
		options: jsonb('options').$type<QuestionOption[]>(),
		// single/multi only: offers a free-text "その他" after the options.
		allowOther: boolean('allow_other').notNull().default(false),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	// Not unique: reordering would otherwise need a two-phase update.
	(t) => [index('question_form_id_position_idx').on(t.formId, t.position)]
);

export const response = pgTable(
	'response',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		formId: text('form_id')
			.notNull()
			.references(() => form.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'restrict' }),
		// Denormalized so non-submitter diffs against guild_member need no join.
		discordId: text('discord_id').notNull(),
		submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		uniqueIndex('response_form_user_uq').on(t.formId, t.userId),
		index('response_form_discord_idx').on(t.formId, t.discordId)
	]
);

export const answer = pgTable(
	'answer',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		responseId: integer('response_id')
			.notNull()
			.references(() => response.id, { onDelete: 'cascade' }),
		/**
		 * Must stay 'no action'. Do NOT change this back to 'restrict': deleting a form
		 * cascades down two paths (form -> question and form -> response -> answer), and
		 * Postgres checks the question FK before the answer rows are gone, so 'restrict'
		 * makes every form with at least one answer undeletable.
		 *
		 * 'no action' alone is not enough either -- it is also checked immediately unless the
		 * constraint is DEFERRABLE, which the Drizzle schema DSL cannot express. The
		 * constraint is therefore recreated as
		 * `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED` by a hand-written migration
		 * (drizzle/0002_deferrable_answer_question_fk.sql). Deferring keeps a bare
		 * `DELETE FROM question` failing (questions are soft-deleted via deleted_at) while
		 * letting a form delete succeed.
		 */
		questionId: integer('question_id')
			.notNull()
			.references(() => question.id, { onDelete: 'no action' }),
		value: jsonb('value').$type<AnswerValue>().notNull()
	},
	(t) => [uniqueIndex('answer_response_question_uq').on(t.responseId, t.questionId)]
);

/**
 * Append-only history: one row per submission whose content differed from the previous one.
 * `answer` keeps only the latest, and every tally and table reads from there.
 */
export const responseRevision = pgTable(
	'response_revision',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		responseId: integer('response_id')
			.notNull()
			.references(() => response.id, { onDelete: 'cascade' }),
		answers: jsonb('answers').$type<RevisionAnswers>().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('response_revision_response_id_idx').on(t.responseId)]
);

export const reminder = pgTable(
	'reminder',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		formId: text('form_id')
			.notNull()
			.references(() => form.id, { onDelete: 'cascade' }),
		kind: reminderKind('kind').notNull(),
		// Null for automatic reminders.
		sentBy: text('sent_by').references(() => user.id),
		// Mentioned, or claimed for a post under way. Members move here from pending one message at a time.
		targetDiscordIds: jsonb('target_discord_ids').$type<string[]>().notNull(),
		/**
		 * Not mentioned yet. Empty once the send is done; left non-empty by a send that failed partway,
		 * which the next send of either kind continues instead of starting over.
		 */
		pendingDiscordIds: jsonb('pending_discord_ids').$type<string[]>().notNull().default([]),
		// Mentions are chunked at 50 users per message, so one send can span several ids.
		messageIds: jsonb('message_ids').$type<string[]>().notNull().default([]),
		/**
		 * The form.deadline this reminder was sent for, captured at send time.
		 * Part of the reminder_auto_once_uq unique index: deadlines can be extended, and
		 * keying the index on form_id alone would make the reminder unsendable forever
		 * after the first one. Null only when the form carries no deadline.
		 */
		targetDeadline: timestamp('target_deadline', { withTimezone: true }),
		sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('reminder_auto_once_uq')
			.on(t.formId, t.targetDeadline)
			.where(sql`${t.kind} = 'auto'`)
	]
);

/**
 * The form editor's saved state, kept apart from `form` so that nothing reading forms has to
 * exclude unpublished ones. The payload is stored unchecked: a draft may be incomplete. An edit of
 * a published form is a draft too, one per form and person, which the top page does not list.
 */
export const formDraft = pgTable(
	'form_draft',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newFormId()),
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		// Set for an edit of a published form, null for a form not created yet.
		formId: text('form_id').references(() => form.id, { onDelete: 'cascade' }),
		// The form.version an edit started from. Null exactly when form_id is.
		baseVersion: integer('base_version'),
		// Typed as the current format; readers must still treat it as unknown.
		payload: jsonb('payload').$type<FormDraftPayload>().notNull(),
		// Optimistic concurrency: every save names the version it read.
		version: integer('version').notNull().default(1),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('form_draft_created_by_idx').on(t.createdBy),
		uniqueIndex('form_draft_edit_uq')
			.on(t.formId, t.createdBy)
			.where(sql`${t.formId} IS NOT NULL`),
		check('form_draft_edit_base', sql`(${t.formId} IS NULL) = (${t.baseVersion} IS NULL)`)
	]
);

/**
 * A respondent's unsent answers, one row per person and form. Stored unchecked like form_draft,
 * and read by nobody but its owner: no count, roster, reminder or history looks at it.
 */
export const responseDraft = pgTable(
	'response_draft',
	{
		formId: text('form_id')
			.notNull()
			.references(() => form.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		// Typed as the answers' shape; readers must still treat it as unknown.
		answers: jsonb('answers').$type<RevisionAnswers>().notNull(),
		// Optimistic concurrency: every save names the version it read, 0 for none yet.
		version: integer('version').notNull().default(1),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.formId, t.userId] })]
);

export type User = typeof user.$inferSelect;
export type GuildMember = typeof guildMember.$inferSelect;
export type Form = typeof form.$inferSelect;
export type Question = typeof question.$inferSelect;
export type Response = typeof response.$inferSelect;
export type Answer = typeof answer.$inferSelect;
export type Reminder = typeof reminder.$inferSelect;
export type FormDraft = typeof formDraft.$inferSelect;
export type ResponseDraft = typeof responseDraft.$inferSelect;
