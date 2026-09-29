import { browser } from '$app/environment';
import { page } from '$app/state';
import { formatJst } from './datetime';

// Whether a date shows its year depends on the clock, and the server's and the browser's may sit
// on either side of New Year. Until the page has hydrated, both judge by the instant the root
// layout's load ran, so that they write the same text; after that, the browser's own clock.
let hydrated = false;

/** Called once the root layout has mounted. */
export function markHydrated() {
	hydrated = true;
}

function displayNow(): Date {
	if (browser && hydrated) return new Date();
	const now: unknown = page.data.now;
	return now instanceof Date ? now : new Date();
}

/** `formatJst` for markup. Must be called while a component renders. */
export function displayJst(value: Date | null, fallback?: string): string {
	return formatJst(value, fallback, displayNow());
}
