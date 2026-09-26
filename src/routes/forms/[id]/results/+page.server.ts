import { error, fail } from '@sveltejs/kit';
import {
	canViewResults,
	closeForm,
	loadForm,
	loadQuestions,
	loadResults,
	reopenForm,
	RosterRefreshError,
	tallyChoices
} from '$lib/server/forms';
import { canManageForm, gateMember, requireUser } from '$lib/server/guards';
import { syncAllMembers } from '$lib/server/guild-sync';
import { announceForm, listReminders, sendReminder } from '$lib/server/notify';
import type { Actions, PageServerLoad } from './$types';

const NOT_FOUND = 'フォームが見つかりません';

const NO_CHANNEL = '告知チャンネルが設定されていないため、Discord へ投稿できません';

const ANNOUNCE_FAILED = 'Discord への告知の投稿に失敗しました';

const REMINDER_FAILURES = {
	not_found: { status: 404, message: NOT_FOUND },
	no_channel: { status: 400, message: NO_CHANNEL },
	no_targets: { status: 409, message: '未提出者がいないため、リマインドは送信していません' },
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

	const target = await loadForm(params.id);
	if (!target) error(404, NOT_FOUND);

	const manage = await canManageForm(locals, target);
	// Managers keep access even after leaving the guild; everyone else needs current membership.
	if (!manage && !(await gateMember(locals))) {
		error(403, 'このサーバーのメンバーではありません');
	}
	if (!canViewResults(target, manage)) error(403, 'この結果はまだ公開されていません');

	// The non-submitter list drives the decision to remind, so refresh the mirror before reading it
	// instead of reading Discord here: one more sync trigger, not a second read path. Gated on
	// manage because canViewResults can let the whole guild onto this page, and listGuildMembers is
	// 10/10s. A failure leaves the last sync time behind in guild_sync rather than going unnoticed.
	if (manage) {
		try {
			await syncAllMembers();
		} catch (cause) {
			console.error('[guild-sync] results refresh failed', cause);
		}
	}

	const questions = await loadQuestions(params.id);
	const results = await loadResults(target);

	return {
		form: {
			id: target.id,
			title: target.title,
			description: target.description,
			visibility: target.visibility,
			deadline: target.deadline,
			closesAt: target.closesAt,
			closedAt: target.closedAt
		},
		manage,
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
		...results
	};
};

/** Actions run before the load, so each repeats the manage check itself. */
async function requireManager(locals: App.Locals, formId: string) {
	const user = requireUser(locals);

	const target = await loadForm(formId);
	if (!target) error(404, NOT_FOUND);
	if (!(await canManageForm(locals, target))) error(403, 'このフォームを操作する権限がありません');

	return { user, target };
}

export const actions: Actions = {
	close: async ({ locals, params }) => {
		await requireManager(locals, params.id);

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
				? fail(404, { message: NOT_FOUND })
				: fail(409, { message: 'このフォームはすでにクローズされています' });
		}

		return { closed: result.frozen };
	},

	reopen: async ({ locals, params }) => {
		await requireManager(locals, params.id);

		if (!(await reopenForm(params.id))) {
			return fail(409, { message: 'このフォームはクローズされていません' });
		}

		return { reopened: true };
	},

	announce: async ({ locals, params }) => {
		await requireManager(locals, params.id);

		const result = await announceForm(params.id);
		if (!result.ok) {
			if (result.reason === 'not_found') return fail(404, { message: NOT_FOUND });
			return result.reason === 'no_channel'
				? fail(400, { message: NO_CHANNEL })
				: fail(502, { message: ANNOUNCE_FAILED });
		}

		return { announced: true };
	},

	remind: async ({ locals, params }) => {
		const { user } = await requireManager(locals, params.id);

		const result = await sendReminder(params.id, { kind: 'manual', sentBy: user.id });
		if (!result.ok) {
			const failure = REMINDER_FAILURES[result.reason];
			return fail(failure.status, { message: failure.message });
		}

		return { reminded: { targets: result.targets, messages: result.messages } };
	}
};
