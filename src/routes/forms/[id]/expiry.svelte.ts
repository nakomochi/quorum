// setTimeout fires at once past 2^31-1 ms (about 24.8 days), so a longer wait is taken in steps.
const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Calls `onExpire` once the time `closesAt` gives (in ms) has passed, read off this browser's
 * clock, which may be wrong. `closesAt` is read reactively; undefined means nothing to wait for.
 * Runs an effect, so it has to be called while a component initialises.
 */
export function watchExpiry(closesAt: () => number | undefined, onExpire: () => void) {
	$effect(() => {
		const at = closesAt();
		if (at === undefined) return;

		let timer: ReturnType<typeof setTimeout> | undefined;
		const wait = () => {
			const remaining = at - Date.now();
			if (remaining <= 0) onExpire();
			else timer = setTimeout(wait, Math.min(remaining, MAX_TIMEOUT));
		};
		wait();
		return () => clearTimeout(timer);
	});
}
