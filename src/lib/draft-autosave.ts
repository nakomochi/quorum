/**
 * Schedules the form editor's draft saves. Plain TypeScript with the network injected, so the
 * timing rules can be tested without a browser.
 *
 * - A change is saved once the editor has been quiet for `debounceMs`, and no later than
 *   `maxWaitMs` after the first unsaved change, however long the typing goes on.
 * - One request at a time. Changes made while it runs are sent once, with the latest content,
 *   after it returns.
 * - A 409 stops saving for good: another tab moved the draft on, created the form or discarded it.
 */

export type SaveStatus =
	| { kind: 'idle' }
	| { kind: 'saving' }
	| { kind: 'saved'; at: Date }
	| { kind: 'failed' }
	| { kind: 'conflict' };

export type SaveRequest = {
	/** Null until the first save has created the draft. */
	id: string | null;
	version: number;
	/** The payload as JSON text. */
	payload: string;
	keepalive: boolean;
};

export type SaveResult =
	| { ok: true; id: string; version: number; updatedAt: Date }
	| { ok: false; conflict: boolean };

export type SaveTransport = (request: SaveRequest) => Promise<SaveResult>;

export type AutosaveOptions = {
	draft: { id: string; version: number; updatedAt: Date } | null;
	/** The editor's current payload as JSON text. */
	read: () => string;
	transport: SaveTransport;
	onStatus: (status: SaveStatus) => void;
	onCreated: (id: string) => void;
	debounceMs?: number;
	maxWaitMs?: number;
	retryMs?: number;
};

const draftUrl = (id: string | null) =>
	id === null ? '/forms/drafts' : `/forms/drafts/${encodeURIComponent(id)}`;

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

/** The payload is already JSON text, so it is spliced into the body rather than parsed again. */
export const fetchTransport: SaveTransport = async ({ id, version, payload, keepalive }) => {
	const response = await fetch(draftUrl(id), {
		method: id === null ? 'POST' : 'PUT',
		headers: JSON_HEADERS,
		body: id === null ? `{"payload":${payload}}` : `{"version":${version},"payload":${payload}}`,
		keepalive
	});
	if (response.status === 409) return { ok: false, conflict: true };
	if (!response.ok) return { ok: false, conflict: false };

	const body = (await response.json()) as { id?: string; version: number; updatedAt: string };
	return {
		ok: true,
		id: body.id ?? id ?? '',
		version: body.version,
		updatedAt: new Date(body.updatedAt)
	};
};

/** True once the draft is gone, including when something else removed it first. */
export async function discardDraft(id: string): Promise<boolean> {
	try {
		const response = await fetch(draftUrl(id), { method: 'DELETE', headers: JSON_HEADERS });
		return response.ok || response.status === 404;
	} catch {
		return false;
	}
}

/** Browsers refuse a keepalive request once the pending keepalive bodies pass 64 KiB. */
const KEEPALIVE_BYTES = 60_000;

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

export class DraftAutosave {
	#id: string | null;
	#version: number;
	#savedAt: Date | null;
	#lastSent: string | null = null;

	#dirty = false;
	#firstChangeAt = 0;
	#lastChangeAt = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#inflight: Promise<void> | null = null;

	/** No new request is started. Set for a submission, a conflict, or leaving the page. */
	#stopped = false;
	#conflict = false;
	/** The editor is gone: nothing more is reported to it. */
	#left = false;

	readonly #options: Required<AutosaveOptions>;

	constructor(options: AutosaveOptions) {
		this.#options = { debounceMs: 1500, maxWaitMs: 10_000, retryMs: 10_000, ...options };
		this.#id = options.draft?.id ?? null;
		this.#version = options.draft?.version ?? 0;
		this.#savedAt = options.draft?.updatedAt ?? null;
	}

	get id() {
		return this.#id;
	}

	/** Takes what the editor shows now as saved, so that opening the page never saves by itself. */
	start() {
		this.#lastSent = this.#options.read();
	}

	changed() {
		if (this.#stopped) return;
		const now = Date.now();
		if (!this.#dirty) {
			this.#dirty = true;
			this.#firstChangeAt = now;
		}
		this.#lastChangeAt = now;
		if (!this.#inflight) this.#schedule();
	}

	#clearTimer() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	#schedule() {
		this.#clearTimer();
		const { debounceMs, maxWaitMs } = this.#options;
		const due = Math.min(this.#lastChangeAt + debounceMs, this.#firstChangeAt + maxWaitMs);
		this.#timer = setTimeout(() => void this.flush(), Math.max(0, due - Date.now()));
	}

	/**
	 * Saves the pending change now. `keepalive` lets the request outlive the page when the body is
	 * small enough for the browser to accept it; otherwise it goes as a normal request.
	 */
	flush(keepalive = false): Promise<void> {
		this.#clearTimer();
		if (this.#inflight) return this.#inflight;
		if (this.#stopped || !this.#dirty) return Promise.resolve();

		this.#dirty = false;
		const payload = this.#options.read();
		if (payload === this.#lastSent) {
			this.#report(this.#savedAt ? { kind: 'saved', at: this.#savedAt } : { kind: 'idle' });
			return Promise.resolve();
		}

		const run = this.#send(payload, keepalive).finally(() => {
			this.#inflight = null;
			// Changes made meanwhile go out once, as soon as their own wait is over.
			if (!this.#stopped && this.#dirty && this.#timer === undefined) this.#schedule();
		});
		this.#inflight = run;
		return run;
	}

	async #send(payload: string, keepalive: boolean) {
		this.#report({ kind: 'saving' });

		let result: SaveResult;
		try {
			result = await this.#options.transport({
				id: this.#id,
				version: this.#version,
				payload,
				keepalive: keepalive && byteLength(payload) <= KEEPALIVE_BYTES
			});
		} catch {
			result = { ok: false, conflict: false };
		}

		if (result.ok) {
			const created = this.#id === null;
			this.#id = result.id;
			this.#version = result.version;
			this.#savedAt = result.updatedAt;
			this.#lastSent = payload;
			this.#report({ kind: 'saved', at: result.updatedAt });
			if (created && !this.#left) this.#options.onCreated(result.id);
			return;
		}

		// Stopped for a submission: a 409 there is the submission deleting the draft.
		if (this.#stopped) return;

		if (result.conflict) {
			this.#conflict = true;
			this.#stopped = true;
			this.#dirty = false;
			this.#clearTimer();
			this.#report({ kind: 'conflict' });
			return;
		}

		// Kept unsaved and tried again later, or sooner when the editor changes.
		this.#report({ kind: 'failed' });
		this.#dirty = true;
		this.#firstChangeAt = this.#lastChangeAt = Date.now();
		this.#clearTimer();
		this.#timer = setTimeout(() => void this.flush(), this.#options.retryMs);
	}

	#report(status: SaveStatus) {
		if (!this.#left) this.#options.onStatus(status);
	}

	/**
	 * For a submission or a discard: drops the pending save and resolves once a request already
	 * on its way has returned, so that the draft's id is known and no save follows.
	 */
	stop(): Promise<void> {
		this.#stopped = true;
		this.#dirty = false;
		this.#clearTimer();
		return this.#inflight ?? Promise.resolve();
	}

	/** After a submission or discard that failed: saves what the dropped save would have. */
	resume() {
		if (!this.#stopped || this.#conflict || this.#left) return;
		this.#stopped = false;
		this.changed();
	}

	/** The editor is going away: sends what is pending and reports nothing more. */
	leave() {
		if (this.#left) return;
		void this.flush(true);
		this.#left = true;
		this.#stopped = true;
		this.#clearTimer();
	}
}
