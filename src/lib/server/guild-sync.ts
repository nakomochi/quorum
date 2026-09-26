import { and, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from './db';
import { guildMember, guildSync, type GuildMember } from './db/schema';
import {
	getGuild,
	getGuildMember,
	listGuildMembers,
	listGuildRoles,
	type DiscordGuildMember
} from './discord';

// Keeps the bind-parameter count of a multi-row INSERT well inside Postgres' 65535 limit.
const UPSERT_CHUNK_SIZE = 500;

export type SyncAllResult = {
	/** Members Discord returned, i.e. the guild's current size. */
	present: number;
	/** Rows that were in the mirror as active but are no longer in the guild. */
	markedLeft: number;
	syncedAt: Date;
};

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

// `excluded` rather than literals: the same clause serves multi-row inserts.
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

let runningSync: Promise<SyncAllResult> | null = null;

/**
 * The mirror's only writer. Concurrent callers share the sync already in flight instead of paging
 * the whole guild again. Departed rows are kept rather than deleted so old answers stay
 * attributable.
 */
export function syncAllMembers(): Promise<SyncAllResult> {
	// Cleared on failure too: a rejected promise left in place would fail every later sync.
	runningSync ??= runFullSync().finally(() => {
		runningSync = null;
	});
	return runningSync;
}

async function runFullSync(): Promise<SyncAllResult> {
	const [members, guild, roles] = await Promise.all([
		listGuildMembers(),
		getGuild(),
		listGuildRoles()
	]);
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

		// Same transaction as the mirror rewrite: the stamp and roles must never outlive a rollback.
		const snapshot = {
			lastFullSyncAt: syncedAt,
			ownerId: guild.owner_id,
			roles: roles.map(({ id, permissions }) => ({ id, permissions }))
		};
		await tx
			.insert(guildSync)
			.values({ id: 1, ...snapshot })
			.onConflictDoUpdate({ target: guildSync.id, set: snapshot });

		return { present: rows.length, markedLeft: departed.length, syncedAt };
	});
}

const memberLookups = new Map<string, Promise<DiscordGuildMember | null>>();

function lookupMember(discordId: string): Promise<DiscordGuildMember | null> {
	let lookup = memberLookups.get(discordId);
	if (!lookup) {
		lookup = getGuildMember(discordId).finally(() => memberLookups.delete(discordId));
		memberLookups.set(discordId, lookup);
	}
	return lookup;
}

function sameRoles(a: string[], b: string[]): boolean {
	const left = new Set(a);
	const right = new Set(b);
	return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * Checks one member against Discord and, on any disagreement with the mirrored row, repairs the
 * mirror with a full sync. The live answer is never written: the full sync stays the only writer.
 * True when a sync ran. A Discord failure returns false, so the caller's refusal stands.
 */
export async function reconcileMember(
	discordId: string,
	mirrored: Pick<GuildMember, 'roleIds'> | null
): Promise<boolean> {
	try {
		const live = await lookupMember(discordId);
		const agrees =
			live === null
				? mirrored === null
				: mirrored !== null && sameRoles(live.roles, mirrored.roleIds);
		if (agrees) return false;

		await syncAllMembers();
		return true;
	} catch (cause) {
		console.error('[guild-sync] member reconcile failed', cause);
		return false;
	}
}

/** Null before the first full sync. */
export async function lastSyncedAt(): Promise<Date | null> {
	const [row] = await db
		.select({ value: guildSync.lastFullSyncAt })
		.from(guildSync)
		.where(eq(guildSync.id, 1));
	return row?.value ?? null;
}

/** Owner and role permissions as of the last full sync. Null before the first one. */
export async function syncedGuildRoles() {
	const [row] = await db
		.select({ ownerId: guildSync.ownerId, roles: guildSync.roles })
		.from(guildSync)
		.where(eq(guildSync.id, 1));
	return row ?? null;
}
