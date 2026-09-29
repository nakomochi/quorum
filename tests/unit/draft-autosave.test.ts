import { describe, expect, test } from 'bun:test';
import {
	DraftAutosave,
	MIN_SAVE_INTERVAL_MS,
	type SaveRequest,
	type SaveResult,
	type SaveStatus
} from '../../src/lib/draft-autosave';
import { sleep } from '../helpers/fixtures';

// Scaled down from 1 s / 10 s so the rules can be watched in real time.
const INTERVAL = 100;
const RETRY = 300;
// Timers and Date.now() both round to the millisecond.
const SLACK = 2;

function harness(
	options: {
		latency?: number;
		answer?: (request: SaveRequest) => SaveResult;
		defaultInterval?: boolean;
	} = {}
) {
	let content = 'initial';
	let inflight = 0;
	let maxInflight = 0;
	const requests: (SaveRequest & { at: number })[] = [];
	const statuses: SaveStatus['kind'][] = [];
	const reports: SaveStatus[] = [];
	const created: string[] = [];
	const began = Date.now();

	const autosave = new DraftAutosave({
		draft: null,
		read: () => content,
		transport: async (request) => {
			requests.push({ ...request, at: Date.now() - began });
			inflight++;
			maxInflight = Math.max(maxInflight, inflight);
			await sleep(options.latency ?? 5);
			inflight--;
			return (
				options.answer?.(request) ?? {
					ok: true,
					id: request.id ?? 'draft-1',
					version: request.version + 1,
					updatedAt: new Date()
				}
			);
		},
		onStatus: (status) => {
			statuses.push(status.kind);
			reports.push(status);
		},
		onCreated: (id) => created.push(id),
		...(options.defaultInterval ? {} : { minIntervalMs: INTERVAL }),
		retryMs: RETRY
	});
	autosave.start();

	return {
		autosave,
		requests,
		statuses,
		reports,
		created,
		maxInflight: () => maxInflight,
		/** Milliseconds since the harness was made, on the clock the requests are stamped with. */
		now: () => Date.now() - began,
		edit(next: string) {
			content = next;
			autosave.changed();
		}
	};
}

const payloads = (h: ReturnType<typeof harness>) => h.requests.map((r) => r.payload);

const gaps = (h: ReturnType<typeof harness>) =>
	h.requests.slice(1).map((r, i) => r.at - h.requests[i].at);

describe('DraftAutosave', () => {
	test('the first change is sent at once', async () => {
		const h = harness();
		const editedAt = h.now();
		h.edit('a');
		await sleep(15);

		expect(payloads(h)).toEqual(['a']);
		expect(h.requests[0].at - editedAt).toBeLessThan(15);
		expect(h.statuses).toEqual(['saving', 'saved']);
	});

	test('edits made in one task go out as one request', async () => {
		const h = harness();
		h.edit('a');
		h.edit('ab');
		h.edit('abc');
		await sleep(20);

		expect(payloads(h)).toEqual(['abc']);
	});

	test('one request at a time; edits made meanwhile go out once, with the latest content', async () => {
		const h = harness({ latency: 150 });
		h.edit('first');
		await sleep(20);
		h.edit('second');
		await sleep(20);
		h.edit('third');
		await sleep(80);
		expect(payloads(h)).toEqual(['first']);

		await sleep(250);

		expect(h.maxInflight()).toBe(1);
		expect(payloads(h)).toEqual(['first', 'third']);
		// Sent as soon as the first returned, the interval being long over by then.
		expect(h.requests[1].at - h.requests[0].at).toBeGreaterThanOrEqual(150 - SLACK);
		expect(h.requests[1].at - h.requests[0].at).toBeLessThan(150 + 30);
	});

	test('a change soon after a save waits out the interval, and changes meanwhile go out once', async () => {
		const h = harness();
		h.edit('a');
		await sleep(20);
		h.edit('b');
		await sleep(20);
		h.edit('c');
		await sleep(20);
		expect(payloads(h)).toEqual(['a']);

		await sleep(INTERVAL);

		expect(payloads(h)).toEqual(['a', 'c']);
		expect(gaps(h)[0]).toBeGreaterThanOrEqual(INTERVAL - SLACK);
		expect(gaps(h)[0]).toBeLessThan(INTERVAL + 30);
	});

	test('a change after a quiet spell longer than the interval is sent at once', async () => {
		const h = harness();
		h.edit('a');
		await sleep(INTERVAL + 30);
		const editedAt = h.now();
		h.edit('b');
		await sleep(15);

		expect(payloads(h)).toEqual(['a', 'b']);
		expect(h.requests[1].at - editedAt).toBeLessThan(15);
	});

	test('continuous typing is sent at most once per interval, and the last edit is saved', async () => {
		const h = harness({ latency: 20 });
		const typing = 700;
		const began = h.now();
		let i = 0;
		while (h.now() - began < typing) {
			h.edit(`text ${i++}`);
			await sleep(10);
		}
		const last = `text ${i - 1}`;
		await sleep(INTERVAL + 60);

		expect(h.requests.length).toBeGreaterThanOrEqual(typing / INTERVAL - 1);
		expect(h.requests.length).toBeLessThanOrEqual(Math.ceil(typing / INTERVAL) + 1);
		for (const gap of gaps(h)) expect(gap).toBeGreaterThanOrEqual(INTERVAL - SLACK);
		expect(h.maxInflight()).toBe(1);
		expect(payloads(h).at(-1)).toBe(last);
		expect(h.statuses.at(-1)).toBe('saved');
	});

	test('the interval defaults to one second', async () => {
		expect(MIN_SAVE_INTERVAL_MS).toBe(1000);

		const h = harness({ defaultInterval: true });
		h.edit('a');
		await sleep(20);
		h.edit('b');
		await sleep(900);
		expect(payloads(h)).toEqual(['a']);

		await sleep(200);

		expect(payloads(h)).toEqual(['a', 'b']);
		expect(gaps(h)[0]).toBeGreaterThanOrEqual(MIN_SAVE_INTERVAL_MS - SLACK);
	});

	test('the first save creates the draft once; later saves name it and the version read', async () => {
		const h = harness();
		h.edit('a');
		await sleep(20);
		h.edit('b');
		await sleep(INTERVAL + 20);

		expect(h.created).toEqual(['draft-1']);
		expect(h.requests.map((r) => [r.id, r.version])).toEqual([
			[null, 0],
			['draft-1', 1]
		]);
		expect(h.autosave.id).toBe('draft-1');
	});

	test('nothing is sent while the content matches what was saved', async () => {
		const h = harness();
		h.autosave.changed();
		await sleep(20);
		h.edit('x');
		h.edit('initial');
		await sleep(20);

		expect(h.requests).toHaveLength(0);
	});

	test('a conflict stops saving for good', async () => {
		const h = harness({ answer: () => ({ ok: false, reason: 'conflict' }) });
		h.edit('a');
		await sleep(20);
		h.edit('b');
		await sleep(INTERVAL + 20);
		h.autosave.resume();
		await h.autosave.flush();

		expect(h.requests).toHaveLength(1);
		expect(h.statuses.at(-1)).toBe('conflict');
	});

	test('a form found closed stops saving for good, reported as closed', async () => {
		const h = harness({ answer: () => ({ ok: false, reason: 'closed' }) });
		h.edit('a');
		await sleep(20);
		h.edit('b');
		await sleep(INTERVAL + 20);
		h.autosave.resume();
		await h.autosave.flush();

		expect(h.requests).toHaveLength(1);
		expect(h.statuses).toEqual(['saving', 'closed']);
	});

	test('a failure is shown and retried later', async () => {
		let fail = true;
		const h = harness({
			answer: (request) =>
				fail
					? { ok: false, reason: 'error' }
					: { ok: true, id: 'draft-1', version: request.version + 1, updatedAt: new Date() }
		});
		h.edit('a');
		await sleep(20);
		expect(h.statuses).toEqual(['saving', 'failed']);
		expect(h.reports.at(-1)).toEqual({ kind: 'failed', tooLarge: false });

		fail = false;
		await sleep(INTERVAL + 20);
		expect(payloads(h)).toEqual(['a']);

		await sleep(RETRY - INTERVAL + 20);

		expect(payloads(h)).toEqual(['a', 'a']);
		expect(gaps(h)[0]).toBeGreaterThanOrEqual(RETRY - SLACK);
		expect(h.statuses.at(-1)).toBe('saved');
	});

	test('a change during the wait for a retry is sent once the interval allows', async () => {
		let fail = true;
		const h = harness({
			answer: (request) =>
				fail
					? { ok: false, reason: 'error' }
					: { ok: true, id: 'draft-1', version: request.version + 1, updatedAt: new Date() }
		});
		h.edit('a');
		await sleep(20);
		fail = false;
		h.edit('ab');
		await sleep(INTERVAL + 20);

		expect(payloads(h)).toEqual(['a', 'ab']);
		expect(gaps(h)[0]).toBeGreaterThanOrEqual(INTERVAL - SLACK);
		expect(gaps(h)[0]).toBeLessThan(RETRY);
		expect(h.statuses.at(-1)).toBe('saved');
	});

	test('a body too large is reported as such and not retried until the editor changes', async () => {
		const h = harness({
			answer: (request) =>
				request.payload.length > 3
					? { ok: false, reason: 'too_large' }
					: { ok: true, id: 'draft-1', version: request.version + 1, updatedAt: new Date() }
		});
		h.edit('large');
		await sleep(20);
		expect(h.reports.at(-1)).toEqual({ kind: 'failed', tooLarge: true });

		await sleep(RETRY + 30);
		expect(payloads(h)).toEqual(['large']);

		h.edit('ok');
		await sleep(20);
		expect(payloads(h)).toEqual(['large', 'ok']);
		expect(h.statuses.at(-1)).toBe('saved');
	});

	test('stop drops the pending save and waits for the one in flight', async () => {
		const h = harness({ latency: 60 });
		h.edit('a');
		await sleep(10);
		h.edit('b');

		await h.autosave.stop();
		expect(h.autosave.id).toBe('draft-1');
		await sleep(INTERVAL + 80);
		expect(payloads(h)).toEqual(['a']);

		// A refused submission resumes, and the dropped change is saved after all.
		h.autosave.resume();
		await sleep(80);
		expect(payloads(h)).toEqual(['a', 'b']);
	});

	test('flush sends at once, inside the interval too, and asks for keepalive only for a small body', async () => {
		const h = harness();
		h.edit('small');
		await h.autosave.flush(true);
		h.edit('x'.repeat(70_000));
		await h.autosave.flush(true);

		expect(h.requests.map((r) => r.keepalive)).toEqual([true, false]);
		expect(gaps(h)[0]).toBeLessThan(INTERVAL);
	});

	test('a flush while a request is in flight leaves the pending change to follow it', async () => {
		const h = harness({ latency: 60 });
		h.edit('a');
		await sleep(10);
		h.edit('b');
		await h.autosave.flush(true);
		expect(payloads(h)).toEqual(['a']);

		await sleep(INTERVAL);

		expect(payloads(h)).toEqual(['a', 'b']);
		expect(h.maxInflight()).toBe(1);
	});

	test('after leave nothing more is reported', async () => {
		const h = harness({ latency: 30 });
		h.edit('a');
		h.autosave.leave();
		await sleep(60);

		expect(payloads(h)).toEqual(['a']);
		expect(h.created).toEqual([]);
		expect(h.statuses).toEqual(['saving']);
	});
});
