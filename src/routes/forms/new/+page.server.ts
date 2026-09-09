import { fail, redirect } from '@sveltejs/kit';
import { listGuildChannels } from '$lib/server/discord';
import {
	createForm,
	FormInputError,
	parseCreateFormPayload,
	selectableRoles
} from '$lib/server/forms';
import { requireMember } from '$lib/server/guards';
import { announceForm } from '$lib/server/notify';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	await requireMember(locals);

	const [roles, channels] = await Promise.all([selectableRoles(), listGuildChannels()]);

	return {
		roles: roles.map((role) => ({ id: role.id, name: role.name })),
		channels: channels
			.map((channel) => ({ id: channel.id, name: channel.name }))
			.sort((a, b) => a.name.localeCompare(b.name))
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		// Actions run independently of the layout load, so membership is re-checked here.
		const { user } = await requireMember(locals);
		const data = await request.formData();

		try {
			const input = parseCreateFormPayload(data);

			// The role list is re-fetched rather than trusted: the client could post @everyone,
			// a bot role, or an id from another guild.
			const roles = await selectableRoles();
			if (!roles.some((role) => role.id === input.targetRoleId)) {
				return fail(400, { message: '対象ロールが不正です' });
			}

			if (input.announcementChannelId) {
				const channels = await listGuildChannels();
				if (!channels.some((channel) => channel.id === input.announcementChannelId)) {
					return fail(400, { message: '告知チャンネルが不正です' });
				}
			}

			// Not /forms/<id>: a creator without the target role cannot pass that page's canSubmit.
			const id = await createForm(input, user.id);

			// The form is already committed: a Discord outage is reported on the results page, which
			// offers the post again, rather than being turned into a failed creation.
			if (input.announcementChannelId && !(await announceForm(id)).ok) {
				redirect(303, `/forms/${id}/results?announce=failed`);
			}

			redirect(303, '/');
		} catch (error) {
			// redirect() signals by throwing, so only FormInputError may be swallowed here.
			if (error instanceof FormInputError) return fail(400, { message: error.message });
			throw error;
		}
	}
};
