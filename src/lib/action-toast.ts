/**
 * Which toast an action result calls for. Apart from the toast store, whose runes only the Svelte
 * compiler reads, so that it runs under plain TypeScript too.
 */

/** A success fades on its own; an error or a warning stays until it is closed. */
export type ToastKind = 'success' | 'error' | 'warning';

/**
 * What an action result says as a toast: `notice` on success, `message` on failure, and an input
 * error that no field or question can show. An input error with a place is drawn there instead.
 */
export function toastOf(result: unknown): { kind: ToastKind; text: string } | null {
	if (!result || typeof result !== 'object') return null;
	const { notice, message, inputError } = result as {
		notice?: unknown;
		message?: unknown;
		inputError?: { message?: unknown; at?: unknown } | null;
	};
	if (typeof notice === 'string') return { kind: 'success', text: notice };
	if (typeof message === 'string') return { kind: 'error', text: message };
	if (inputError && inputError.at === null && typeof inputError.message === 'string') {
		return { kind: 'error', text: inputError.message };
	}
	return null;
}
