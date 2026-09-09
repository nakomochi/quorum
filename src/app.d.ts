import type { Session, SessionUser } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			session?: Session;
			user?: SessionUser;
		}
	}
}

export {};
