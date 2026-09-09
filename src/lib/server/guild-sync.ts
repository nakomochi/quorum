import { and, isNotNull, isNull, max, notInArray, sql } from 'drizzle-orm';
import { db } from './db';
import { guildMember } from './db/schema';
import { getGuildMember, listGuildMembers, type DiscordGuildMember } from './discord';

// Keeps the bind-parameter count of a multi-row INSERT well inside Postgres' 65535 limit.
const UPSERT_CHUNK_SIZE = 500;

export type SyncAllResult = {
	/** Members Discord returned, i.e. the guild's current size. */
	present: number;
	/** Rows that were in the mirror as active but are no longer in the guild. */
	markedLeft: number;
	syncedAt: Date;
};

export type SyncOwnResult = { status: 'synced' | 'not_in_guild' };

type GuildMemberRow = typeof guildMember.$inferInsert;

function toRow(member: DiscordGuildMember, syncedAt: Date): GuildMemberRow {
	return {
		discordId: member.user.id,
		username: member.user.username,
		globalName: member.user.global_name ?? null,
		nickname: member.nick ?? null,
		avatarHash: member.user.avatar ?? null,
		roleIds: member.roles,
		isBot: member.user.bot ?? false,
		joinedAt: member.joined_at ? new Date(member.joined_at) : null,
		// Clears a previous departure: the member is demonstrably back in the guild.
		leftAt: null,
		syncedAt
	};
}

// `excluded` is required rather than literal values because the same clause serves
// multi-row inserts, where a single literal would be wrong for every row but one.
const UPSERT_SET = {
	username: sql`excluded.username`,
	globalName: sql`excluded.global_name`,
	nickname: sql`excluded.nickname`,
	avatarHash: sql`excluded.avatar_hash`,
	roleIds: sql`excluded.role_ids`,
	isBot: sql`excluded.is_bot`,
	joinedAt: sql`excluded.joined_at`,
	leftAt: sql`excluded.left_at`,
	syncedAt: sql`excluded.synced_at`
};

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * Full refresh of the guild_member mirror: upsert everyone Discord returned and flag
 * everyone it did not as departed. Departed rows are kept so old answers stay attributable.
 */
export async function syncAllMembers(): Promise<SyncAllResult> {
	const members = await listGuildMembers();
	const syncedAt = new Date();
	const rows = members.map((member) => toRow(member, syncedAt));

	// A guild always contains at least the bot itself, so an empty list means the request
	// silently misfired. Marking the whole mirror as departed on that would be unrecoverable.
	if (rows.length === 0) {
		throw new Error('Discord returned no guild members; refusing to mark the mirror as departed');
	}

	const presentIds = rows.map((row) => row.discordId);

	return db.transaction(async (tx) => {
		for (const batch of chunk(rows, UPSERT_CHUNK_SIZE)) {
			await tx
				.insert(guildMember)
				.values(batch)
				.onConflictDoUpdate({ target: guildMember.discordId, set: UPSERT_SET });
		}

		const absent = notInArray(guildMember.discordId, presentIds);

		const departed = await tx
			.update(guildMember)
			.set({ leftAt: syncedAt, syncedAt })
			.where(and(absent, isNull(guildMember.leftAt)))
			.returning({ discordId: guildMember.discordId });

		// leftAt is left at its original value: it records when the departure was first seen.
		// syncedAt still advances so that it means "last checked" for every row in the table.
		await tx
			.update(guildMember)
			.set({ syncedAt })
			.where(and(absent, isNotNull(guildMember.leftAt)));

		return { present: rows.length, markedLeft: departed.length, syncedAt };
	});
}

/**
 * Refresh a single member. Called on every login so that someone who just joined the guild
 * appears in the mirror without waiting for an admin to run a full sync.
 */
export async function syncOwnMember(discordId: string): Promise<SyncOwnResult> {
	const member = await getGuildMember(discordId);
	if (!member) return { status: 'not_in_guild' };

	await db
		.insert(guildMember)
		.values(toRow(member, new Date()))
		.onConflictDoUpdate({ target: guildMember.discordId, set: UPSERT_SET });

	return { status: 'synced' };
}

/** Null before the first sync. */
export async function lastSyncedAt(): Promise<Date | null> {
	const [row] = await db.select({ value: max(guildMember.syncedAt) }).from(guildMember);
	return row?.value ?? null;
}
