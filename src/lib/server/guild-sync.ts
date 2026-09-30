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

// ASCII "fdsync". Arbitrary, but distinctive enough not to collide with other advisory locks.
const FULL_SYNC_LOCK_KEY = 0x6664_7379_6e63;

export type SyncAllResult = {
	/** Members Discord returned, i.e. the guild's current size. */
	present: number;
	/** Rows that were in the mirror as active but are no longer in the guild. */
	markedLeft: number;
	/**
	 * When the member list was fetched, as the mirror records it. A sync kept out by a newer one
	 * writes nothing and reports that one's time, with markedLeft 0.
	 */
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
		guildAvatarHash: member.avatar ?? null,
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
	guildAvatarHash: sql`excluded.guild_avatar_hash`,
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
let queuedSync: Promise<SyncAllResult> | null = null;

/**
 * The mirror's only writer. The sync it returns started fetching no earlier than the call: callers
 * sync because something just changed, and a sync already in flight may have fetched before that.
 * A call during a sync therefore waits for one queued after it, which every such call shares, so a
 * process runs at most one sync and queues at most one more. Departed rows are kept rather than
 * deleted so old answers stay attributable.
 */
export function syncAllMembers(): Promise<SyncAllResult> {
	// Not started yet, so it starts after this call.
	if (queuedSync) return queuedSync;
	if (!runningSync) return startSync();

	// Runs whatever the outcome of the one before: that failure belongs to that sync's callers.
	queuedSync = runningSync
		.catch(() => undefined)
		.then(() => {
			queuedSync = null;
			return startSync();
		});
	return queuedSync;
}

function startSync(): Promise<SyncAllResult> {
	// Cleared on failure too: a rejected promise left in place would fail every later sync.
	const run = runFullSync().finally(() => {
		if (runningSync === run) runningSync = null;
	});
	runningSync = run;
	return run;
}

let lastStartedAt = 0;

async function runFullSync(): Promise<SyncAllResult> {
	// Taken before the fetch: the list is current as of this time at least, and it is what the mirror
	// records. Kept strictly after this process's previous sync, which has finished by now, so that a
	// tie within one millisecond does not make this one look stale to the check below.
	lastStartedAt = Math.max(Date.now(), lastStartedAt + 1);
	const syncedAt = new Date(lastStartedAt);
	const [members, guild, roles] = await Promise.all([
		listGuildMembers(),
		getGuild(),
		listGuildRoles()
	]);
	const rows = members.map((member) => toRow(member, syncedAt));

	// A guild always contains at least the bot itself, so an empty list means the request
	// silently misfired. Marking the whole mirror as departed on that would be unrecoverable.
	if (rows.length === 0) {
		throw new Error('Discord returned no guild members; refusing to mark the mirror as departed');
	}

	const presentIds = rows.map((row) => row.discordId);

	return db.transaction(async (tx) => {
		// The queue above is per process. Two processes (e.g. old and new containers during
		// a deploy) holding member lists that disagree would upsert and mark departed the same rows
		// in opposite orders and deadlock, so full syncs are serialized across processes too.
		await tx.execute(sql`select pg_advisory_xact_lock(${FULL_SYNC_LOCK_KEY}::bigint)`);

		// A sync that started fetching later, in another process, committed while this one fetched
		// or waited for the lock. Its list is the newer one and is kept.
		const [newer] = await tx
			.select({ at: guildSync.lastFullSyncAt })
			.from(guildSync)
			.where(eq(guildSync.id, 1));
		if (newer && newer.at.getTime() >= syncedAt.getTime()) {
			return { present: rows.length, markedLeft: 0, syncedAt: newer.at };
		}

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

export type Reconciled = {
	/** The member as Discord reports them now. Null when not in the guild. */
	live: DiscordGuildMember | null;
	/** True when the mirror disagreed and a full sync has since repaired it. */
	synced: boolean;
};

/**
 * Checks one member against Discord and, on any disagreement with the mirrored row, repairs the
 * mirror with a full sync. The live answer is never written: the full sync stays the only writer.
 * A failed lookup throws. A failed sync is only logged: the live answer stands either way.
 *
 * Runs where a gate is about to refuse and on every write. A change no member lookup can see, such
 * as a role's permissions changing or a new owner, waits for the next full sync.
 */
export async function reconcileMember(
	discordId: string,
	mirrored: Pick<GuildMember, 'roleIds'> | null
): Promise<Reconciled> {
	const live = await lookupMember(discordId);
	const agrees =
		live === null ? mirrored === null : mirrored !== null && sameRoles(live.roles, mirrored.roleIds);
	if (agrees) return { live, synced: false };

	try {
		await syncAllMembers();
		return { live, synced: true };
	} catch (cause) {
		console.error('[guild-sync] repair sync after a member check failed', cause);
		return { live, synced: false };
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
