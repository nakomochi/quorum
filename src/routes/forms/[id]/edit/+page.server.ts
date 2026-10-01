import { error, fail, isHttpError, redirect } from '@sveltejs/kit';
import { toJstLocal } from '$lib/datetime';
import { readDraftPayload } from '$lib/form-draft';
import { listGuildChannels } from '$lib/server/discord';
import {
	discardEditDraft,
	editLocks,
	openEditDraft,
	publishFormEdit,
	withLocksApplied
} from '$lib/server/form-edit';
import {
	FormInputError,
	loadQuestions,
	parseCreateFormPayload,
	selectableRoles
} from '$lib/server/forms';
import { FORM_NOT_FOUND, requireFormManager } from '$lib/server/guards';
import { syncAllMembers } from '$lib/server/guild-sync';
import { postDeadlineChange, refreshAnnouncement } from '$lib/server/notify';
import type { Actions, PageServerLoad } from './$types';

const CLOSED = 'このフォームは確定済みのため編集できません。受付を再開してから編集してください。';

const STALE = 'ほかの人が先に変更を公開しました。最新の内容を読み込み直してください。';

const UNAVAILABLE =
	'Discord に接続できないため、今は公開できません。時間をおいてもう一度公開してください。';

/**
 * Every refusal but an input error, in one type: inferred apart, the shape with a reason would be
 * folded into the one with a message only, and drop out of the page's types.
 */
type Refusal = { reason?: 'stale'; message: string };

const refuse = (status: number, refusal: Refusal) => fail(status, refusal);

/**
 * False when a Discord post after the publish failed, or anything under it threw. Having nothing to
 * post is no failure.
 */
async function reported(
	what: string,
	pending: Promise<{ ok: true } | { ok: false; reason: string }>
): Promise<boolean> {
	try {
		const result = await pending;
		return result.ok || (result.reason !== 'edit_failed' && result.reason !== 'post_failed');
	} catch (cause) {
		console.error(`${what} after publishing an edit failed`, cause);
		return false;
	}
}

// Managers only. Opening the page starts the viewer's edit from the form as it is, or resumes the
// one they saved earlier.
export const load: PageServerLoad = async ({ locals, params }) => {
	const { user, target } = await requireFormManager(locals, params.id, 'view');

	const form = { id: target.id, title: target.title };
	// Nothing is read for the editor: the page only says to reopen the form first.
	if (target.closedAt !== null) return { form, closed: true as const, editor: null };

	const draft = await openEditDraft(target, user.id);
	const [roles, channels, locks, questions] = await Promise.all([
		selectableRoles(),
		listGuildChannels(),
		editLocks(target),
		loadQuestions(target.id)
	]);

	return {
		form,
		closed: false as const,
		editor: {
			roles: roles.map((role) => ({ id: role.id, name: role.name })),
			channels: channels
				.map((channel) => ({ id: channel.id, name: channel.name }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			// The payload is read into the editor's fields here, so nothing else stored in it is sent.
			draft: {
				id: draft.id,
				version: draft.version,
				updatedAt: draft.updatedAt,
				state: withLocksApplied(readDraftPayload(draft.payload), target, questions, locks)
			},
			// Posted back with the edit, which is refused once the form has moved past it.
			baseVersion: draft.baseVersion,
			stale: draft.baseVersion !== target.version,
			// The published deadline as the editor writes it, which a change is told apart from. Null
			// when there is no announcement to reply to.
			deadlineReply: target.announcementMessageId
				? { from: target.deadline ? toJstLocal(target.deadline) : '' }
				: null,
			// Saved at least once since it was opened: there are changes the viewer may have forgotten.
			resumed: draft.version > 1,
			locks: { audience: locks.answered, questionTypes: locks.answered, channel: locks.posted }
		}
	};
};

export const actions: Actions = {
	publish: async ({ locals, params, request }) => {
		let manager;
		try {
			manager = await requireFormManager(locals, params.id, 'act');
		} catch (err) {
			// fail rather than error, as in creating a form: the editor keeps what was typed.
			if (isHttpError(err) && err.status === 503) return refuse(503, { message: UNAVAILABLE });
			throw err;
		}
		const { user, target } = manager;
		if (target.closedAt !== null) return refuse(409, { message: CLOSED });

		const data = await request.formData();
		const baseVersion = Number(data.get('baseVersion'));

		try {
			const input = parseCreateFormPayload(data);

			// Checked against Discord only when changed: a locked or kept role or channel may since
			// have been deleted there, and stays as it is.
			if (input.targetRoleId !== target.targetRoleId) {
				const roles = await selectableRoles();
				if (!roles.some((role) => role.id === input.targetRoleId)) {
					throw new FormInputError('対象ロールが不正です', { field: 'targetRoleId' });
				}
			}
			if (
				input.announcementChannelId &&
				input.announcementChannelId !== target.announcementChannelId
			) {
				const channels = await listGuildChannels();
				if (!channels.some((channel) => channel.id === input.announcementChannelId)) {
					throw new FormInputError('告知チャンネルが不正です', { field: 'announcementChannelId' });
				}
			}

			const result = await publishFormEdit(
				target.id,
				user.id,
				Number.isSafeInteger(baseVersion) ? baseVersion : -1,
				input
			);
			if (!result.ok) {
				if (result.reason === 'not_found') error(404, FORM_NOT_FOUND);
				return result.reason === 'closed'
					? refuse(409, { message: CLOSED })
					: refuse(409, { reason: 'stale', message: STALE });
			}

			// As after creating a form: a role granted just before must count among the
			// non-submitters at once. A failure is left to the next sync.
			if (result.roleChanged) {
				try {
					await syncAllMembers();
				} catch (cause) {
					console.error('[guild-sync] roster refresh after changing the target role failed', cause);
				}
			}

			// The edit has committed and stands whatever happens to the posts below. The results page
			// says it was published, and what failed after, once.
			const flags = new URLSearchParams({ published: '1' });
			if (!(await reported('announcement edit', refreshAnnouncement(target.id)))) {
				flags.set('announce_edit', 'failed');
			}
			if (result.deadlineChanged && data.get('notifyDeadline') === 'on') {
				const notice = postDeadlineChange(target.id, input.deadline);
				if (!(await reported('deadline change post', notice))) {
					flags.set('deadline_notice', 'failed');
				}
			}

			redirect(303, `/forms/${target.id}/results?${flags}`);
		} catch (err) {
			// redirect() and error() signal by throwing, so only FormInputError may be swallowed here.
			if (err instanceof FormInputError) return fail(400, { inputError: err.detail });
			throw err;
		}
	},

	// Throws the viewer's edit away and opens the form as it is now. A plain post: the editor reads
	// its starting state only when it is created, so the page is loaded afresh.
	reload: async ({ locals, params }) => {
		const { user, target } = await requireFormManager(locals, params.id, 'view');

		await discardEditDraft(target.id, user.id);

		redirect(303, `/forms/${target.id}/edit`);
	}
};
