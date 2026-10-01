import { fail, redirect } from '@sveltejs/kit';
import { formatJst } from '$lib/datetime';
import { duplicateForm } from '$lib/server/drafts';
import {
	closeForm,
	closesAtPassed,
	isClosed,
	loadQuestions,
	loadResults,
	reopenForm,
	RosterRefreshError,
	tallyChoices
} from '$lib/server/forms';
import { FORM_NOT_FOUND, requireFormManager, requireResultsViewer } from '$lib/server/guards';
import { messageUrl } from '$lib/server/discord';
import { lastSyncedAt, syncAllMembers, syncedGuildRoles } from '$lib/server/guild-sync';
import {
	announceForm,
	announcementStale,
	listReminders,
	postCloseNotice,
	refreshAnnouncement,
	sendReminder
} from '$lib/server/notify';
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
	}
} as const;

function reminderPostFailed(targets: number, remaining: number): string {
	if (remaining === 0) return 'Discord への投稿に失敗しました。送信記録も残していません。';
	const head =
		targets > 0
			? `Discord への投稿が途中で失敗しました。${targets}名にはリマインドを送信済みです。`
			: 'Discord への投稿に失敗しました。';
	return `${head}残りの${remaining}名には、もう一度リマインドすると続きから送信します。`;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { target, manage } = await requireResultsViewer(locals, params.id);

	// Reads the mirror only; a manager refreshes it with ?/syncRoster.
	const questions = await loadQuestions(params.id);
	const results = await loadResults(target);

	// From the last full sync's snapshot, never from Discord. Without one there is nothing to judge
	// by, so no warning. A frozen roster no longer depends on the role or on how fresh the mirror is.
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
		// Set by the redirect the creation page takes when the announcement could not be posted.
		announceFailed: manage && url.searchParams.get('announce') === 'failed',
		// Set by the redirect the edit page takes once the edit is published.
		published: manage && url.searchParams.get('published') === '1',
		// Set beside it when a Discord post after the publish failed.
		announceEditFailed: manage && url.searchParams.get('announce_edit') === 'failed',
		deadlineNoticeFailed: manage && url.searchParams.get('deadline_notice') === 'failed',
		// Links, not ids: the page only needs to open the messages. Whether the announcement is out of
		// date, not what it says.
		announcement: manage
			? {
					hasChannel: target.announcementChannelId !== null,
					url:
						target.announcementChannelId && target.announcementMessageId
							? messageUrl(target.announcementChannelId, target.announcementMessageId)
							: null,
					stale: announcementStale(target)
				}
			: null,
		reminders: manage ? await listReminders(params.id, target.announcementChannelId) : [],
		// Deleted options too, unmarked: the table still names what was answered with them.
		questions: questions.map((q) => ({
			id: q.id,
			label: q.label,
			type: q.type,
			options: q.options?.map(({ id, label }) => ({ id, label })) ?? null
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
		await requireFormManager(locals, params.id, 'act');

		let result;
		try {
			result = await closeForm(params.id);
		} catch (err) {
			// Only the roster refresh is reported as a Discord problem; a database fault must not be
			// disguised as one.
			if (!(err instanceof RosterRefreshError)) throw err;
			return fail(502, {
				message:
					'Discord からメンバー一覧を取得できませんでした。古い情報で確定させないため、締め切っていません。'
			});
		}

		if (!result.ok) {
			return result.reason === 'not_found'
				? fail(404, { message: FORM_NOT_FOUND })
				: fail(409, { message: 'このフォームはすでに締め切って確定済みです' });
		}

		// The close has committed and stands whatever happens here: a failed post is left to the tick.
		try {
			await postCloseNotice(params.id);
		} catch (cause) {
			console.error('close notice after a close by hand failed', cause);
		}

		return {
			notice:
				result.frozen === 0
					? '締め切りました。未提出者はいません。'
					: `締め切りました。未提出者 ${result.frozen}名を確定しました。`
		};
	},

	reopen: async ({ locals, params }) => {
		await requireFormManager(locals, params.id, 'act');

		if (!(await reopenForm(params.id))) {
			return fail(409, { message: 'このフォームはまだ確定していません' });
		}

		return { notice: '受付を再開しました。' };
	},

	announce: async ({ locals, params }) => {
		await requireFormManager(locals, params.id, 'act');

		const result = await announceForm(params.id);
		if (!result.ok) {
			if (result.reason === 'not_found') return fail(404, { message: FORM_NOT_FOUND });
			return result.reason === 'no_channel'
				? fail(400, { message: NO_CHANNEL })
				: fail(502, { message: ANNOUNCE_FAILED });
		}

		return { notice: '告知を投稿しました。' };
	},

	// Edits the announcement to say what the form does now, after an edit could not.
	refreshAnnouncement: async ({ locals, params }) => {
		await requireFormManager(locals, params.id, 'act');

		const result = await refreshAnnouncement(params.id);
		if (!result.ok) {
			return result.reason === 'not_found'
				? fail(404, { message: FORM_NOT_FOUND })
				: fail(502, {
						message: '告知メッセージを更新できませんでした。時間をおいてもう一度お試しください。'
					});
		}

		return { notice: '告知メッセージを更新しました。' };
	},

	remind: async ({ locals, params }) => {
		const { user } = await requireFormManager(locals, params.id, 'act');

		const result = await sendReminder(params.id, { kind: 'manual', sentBy: user.id });
		if (!result.ok) {
			if (result.reason === 'post_failed') {
				return fail(502, { message: reminderPostFailed(result.targets, result.remaining) });
			}
			const failure = REMINDER_FAILURES[result.reason];
			return fail(failure.status, { message: failure.message });
		}

		const split = result.messages > 1 ? `（${result.messages}通に分けて送信）` : '';
		// A reminder left unfinished is sent on before any new one, so this click may only have done that.
		const lead = result.continued ? '途中で止まっていた前回の送信の続きとして、' : '';
		return { notice: `${lead}未提出者 ${result.targets}名にリマインドを送信しました。${split}` };
	},

	// Posted to from the top page's menu; this page has no button for it.
	// Only reads the form, so viewing rights are enough: the copy is a draft of the manager's own.
	duplicate: async ({ locals, params }) => {
		const { user, target } = await requireFormManager(locals, params.id, 'view');

		const draft = await duplicateForm(target, user.id);

		redirect(303, `/forms/new?draft=${draft.id}`);
	},

	syncRoster: async ({ locals, params }) => {
		const { target } = await requireFormManager(locals, params.id, 'act');

		// Closing froze the non-submitters, so a refresh would change nothing on this page.
		if (target.closedAt !== null) {
			return fail(409, {
				message: 'このフォームは確定済みのため、名簿を更新しても未提出者は変わりません'
			});
		}

		try {
			await syncAllMembers();
		} catch (cause) {
			console.error('[guild-sync] roster refresh from the results page failed', cause);
			const syncedAt = await lastSyncedAt();
			return fail(502, {
				message: syncedAt
					? `Discord からメンバー一覧を取得できませんでした。未提出者は前回（${formatJst(syncedAt)}）の名簿のままです。`
					: 'Discord からメンバー一覧を取得できませんでした。名簿がまだ一度も同期されていないため、未提出者を表示できません。'
			});
		}

		return { notice: '名簿を更新しました。' };
	}
};
