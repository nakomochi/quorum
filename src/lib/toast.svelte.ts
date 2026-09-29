/**
 * Transient messages drawn by the root layout's Toaster. Module state, which the server would share
 * between requests: push only from effects and event handlers, never while rendering.
 */

export type ToastKind = 'success' | 'error';

export type Toast = { id: number; kind: ToastKind; text: string };

/** The oldest is dropped past this many. */
const MAX_VISIBLE = 3;

/** A success fades on its own; an error stays until it is closed. */
const SUCCESS_MS = 4000;

class Toasts {
	items = $state<Toast[]>([]);
	#next = 0;
	#timers = new Map<number, ReturnType<typeof setTimeout>>();

	success(text: string) {
		this.#push('success', text);
	}

	error(text: string) {
		this.#push('error', text);
	}

	dismiss(id: number) {
		clearTimeout(this.#timers.get(id));
		this.#timers.delete(id);
		this.items = this.items.filter((item) => item.id !== id);
	}

	// The same message again replaces the one shown, so a repeated failure does not stack up.
	#push(kind: ToastKind, text: string) {
		for (const item of this.items) {
			if (item.kind === kind && item.text === text) this.dismiss(item.id);
		}
		const id = ++this.#next;
		this.items = [...this.items, { id, kind, text }];
		while (this.items.length > MAX_VISIBLE) this.dismiss(this.items[0].id);
		if (kind === 'success') this.#timers.set(id, setTimeout(() => this.dismiss(id), SUCCESS_MS));
	}
}

export const toast = new Toasts();

/**
 * What an action result says as a toast: `notice` on success, `message` on failure. Input errors
 * carry neither, and are drawn beside their field instead.
 */
export function toastOf(result: unknown): { kind: ToastKind; text: string } | null {
	if (!result || typeof result !== 'object') return null;
	const { notice, message } = result as { notice?: unknown; message?: unknown };
	if (typeof notice === 'string') return { kind: 'success', text: notice };
	if (typeof message === 'string') return { kind: 'error', text: message };
	return null;
}
