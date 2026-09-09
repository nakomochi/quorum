import type { Handle, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth';
import { startScheduler } from '$lib/server/scheduler';

export const init: ServerInit = () => {
	// init runs while prerendering too, where a tick would mean a live DB and Discord at build time.
	if (!building) startScheduler();
};

export const handle: Handle = async ({ event, resolve }) => {
	// Skipped while prerendering: getSession would otherwise require a live DB at build time.
	if (!building) {
		const session = await auth.api.getSession({ headers: event.request.headers });

		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};
