import { error, fail } from '@sveltejs/kit';
import {
	canViewResults,
	closeForm,
	closesAtPassed,
	isClosed,
	loadQuestions,
	loadResults,
	reopenForm,
	RosterRefreshError,
	tallyChoices
} from '$lib/server/forms';
import {
	canManageForm,
	FORM_NOT_FOUND,
	gateMember,
	requireForm,
	requireFormManager,
	requireUser
} from '$lib/server/guards';
import { lastSyncedAt, syncAllMembers, syncedGuildRoles } from '$lib/server/guild-sync';
import { announceForm, listReminders, sendReminder } from '$lib/server/notify';
import type { Actions, PageServerLoad } from './$types';

const NO_CHANNEL = '告知チャンネルが設定されていないため、Discord へ投稿できません';

const ANNOUNCE_FAILED = 'Discord への告知の投稿に失敗しました';

const REMINDER_FAILURES = {
	not_found: { status: 404, message: FORM_NOT_FOUND },
	closed: {
		status: 409,
		message: 'このフォームは受付を終了しているため、リマインドは送信していません'
	},
	no_channel: { status: 400, message: NO_CHANNEL },
	no_targets: { status: 409, message: '未提出者がいないため、リマインドは送信していません' },
	empty_roster: {
		status: 409,
		message: '対象ロールを持つメンバーがいないため、リマインドは送信していません'
	},
	already_sent: { status: 409, message: 'この締切に対する自動リマインドは送信済みです' },
	sync_failed: {
		status: 502,
		message:
			'Discord からメンバー一覧を取得できませんでした。古い名簿でメンションしないため、送信していません。'
	},
	post_failed: { status: 502, message: 'Discord への投稿に失敗しました。送信記録も残していません。' }
} as const;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals);

	const target = await requireForm(params.id);

	const manage = await canManageForm(locals, target);
	// canManageForm already requires membership, so only a non-manager is checked here.
	if (!manage && !(await gateMember(locals))) {
		error(403, 'このサーバーのメンバーではありません');
	}
	if (!canViewResults(target, manage)) error(403, 'この結果はまだ公開されていません');

	// The non-submitter list drives the decision to remind, so refresh the mirror before reading it
	// instead of reading Discord here: one more sync trigger, not a second read path. Gated on
	// manage because canViewResults can let the whole guild onto this page, and listGuildMembers is
	// 10/10s. A failure is shown to the manager along with the last sync time left in guild_sync.
	let syncFailed = false;
	if (manage) {
		try {
			await syncAllMembers();
		} catch (cause) {
			syncFailed = true;
			console.error('[guild-sync] results refresh failed', cause);
		}
	}

	const questions = await loadQuestions(params.id);
	const results = await loadResults(target);

	// Read from the snapshot the sync above just wrote, never from Discord. Without one there is
	// nothing to judge by, so no warning. A frozen roster no longer depends on the role or on how
	// fresh the mirror is.
	const liveRoster = manage && !results.frozen;
	const [synced, rosterSyncedAt] = liveRoster
		? await Promise.all([syncedGuildRoles(), lastSyncedAt()])
		: [null, null];
	const roleDeleted =
		synced !== null && !synced.roles.some((role) => role.id === target.targetRoleId);

	return {
		form: {
			id: target.id,
			title: target.title,
			deadline: target.deadline,
			closesAt: target.closesAt,
			// Drawn only in the managers' controls.
			visibility: manage ? target.visibility : null,
			closedAt: manage ? target.closedAt : null
		},
		closed: isClosed(target),
		reopenClearsClosesAt: manage && target.closedAt !== null && closesAtPassed(target),
		manage,
		roleDeleted,
		rosterSyncedAt,
		rosterSyncFailed: liveRoster && syncFailed,
		// Set by the redirect the creation page takes when the announcement could not be posted.
		announceFailed: manage && url.searchParams.get('announce') === 'failed',
		announcement: manage
			? { channelId: target.announcementChannelId, messageId: target.announcementMessageId }
			: null,
		reminders: manage ? await listReminders(params.id) : [],
		questions: questions.map((q) => ({
			id: q.id,
			label: q.label,
			type: q.type,
			options: q.options
		})),
		tallies: tallyChoices(questions, [...results.submitted, ...results.outsiders]),
		frozen: results.frozen,
		targetCount: results.targetCount,
		submitted: results.submitted,
		outsiders: results.outsiders,
		nonSubmitters: results.nonSubmitters
	};
};

// Actions run before the load, so each repeats the manage check itself.
export const actions: Actions = {
	close: async ({ locals, params }) => {
		await requireFormManager(locals, params.id);

		let result;
		try {
			result = await closeForm(params.id);
		} catch (err) {
			// Only the roster refresh is reported as a Discord problem; a database fault must not be
			// disguised as one.
			if (!(err instanceof RosterRefreshError)) throw err;
			return fail(502, {
				message:
					'Discord からメンバー一覧を取得できませんでした。古い情報で確定させないため、クローズしていません。'
			});
		}

		if (!result.ok) {
			return result.reason === 'not_found'
				? fail(404, { message: FORM_NOT_FOUND })
				: fail(409, { message: 'このフォームはすでにクローズされています' });
		}

		return { closed: result.frozen };
	},

	reopen: async ({ locals, params }) => {
		await requireFormManager(locals, params.id);

		if (!(await reopenForm(params.id))) {
			return fail(409, { message: 'このフォームはクローズされていません' });
		}

		return { reopened: true };
	},

	announce: async ({ locals, params }) => {
		await requireFormManager(locals, params.id);

		const result = await announceForm(params.id);
		if (!result.ok) {
			if (result.reason === 'not_found') return fail(404, { message: FORM_NOT_FOUND });
			return result.reason === 'no_channel'
				? fail(400, { message: NO_CHANNEL })
				: fail(502, { message: ANNOUNCE_FAILED });
		}

		return { announced: true };
	},

	remind: async ({ locals, params }) => {
		const { user } = await requireFormManager(locals, params.id);

		const result = await sendReminder(params.id, { kind: 'manual', sentBy: user.id });
		if (!result.ok) {
			const failure = REMINDER_FAILURES[result.reason];
			return fail(failure.status, { message: failure.message });
		}

		return { reminded: { targets: result.targets, messages: result.messages } };
	}
};
