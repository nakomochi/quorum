import { describe, expect, test } from 'bun:test';
import {
	DraftAutosave,
	type SaveRequest,
	type SaveResult,
	type SaveStatus
} from '../../src/lib/draft-autosave';
import { sleep } from '../helpers/fixtures';

// Scaled down from 1.5 s / 10 s so the rules can be watched in real time.
const DEBOUNCE = 40;
const MAX_WAIT = 150;
const RETRY = 100;

function harness(options: { latency?: number; answer?: (request: SaveRequest) => SaveResult } = {}) {
	let content = 'initial';
	let inflight = 0;
	let maxInflight = 0;
	const requests: (SaveRequest & { at: number })[] = [];
	const statuses: SaveStatus['kind'][] = [];
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
		onStatus: (status) => statuses.push(status.kind),
		onCreated: (id) => created.push(id),
		debounceMs: DEBOUNCE,
		maxWaitMs: MAX_WAIT,
		retryMs: RETRY
	});
	autosave.start();

	return {
		autosave,
		requests,
		statuses,
		created,
		maxInflight: () => maxInflight,
		edit(next: string) {
			content = next;
			autosave.changed();
		}
	};
}

describe('DraftAutosave', () => {
	test('saves once the editor has been quiet for the debounce', async () => {
		const h = harness();
		h.edit('a');
		await sleep(DEBOUNCE / 2);
		h.edit('ab');
		await sleep(DEBOUNCE / 2);
		expect(h.requests).toHaveLength(0);

		await sleep(DEBOUNCE + 20);

		expect(h.requests.map((r) => r.payload)).toEqual(['ab']);
		expect(h.statuses).toEqual(['saving', 'saved']);
	});

	test('continuous typing is still saved within the maximum wait', async () => {
		const h = harness();
		for (let i = 0; i < 40; i++) {
			h.edit(`text ${i}`);
			await sleep(10);
		}

		expect(h.requests.length).toBeGreaterThanOrEqual(2);
		expect(h.requests[0].at).toBeLessThan(MAX_WAIT + 40);
	});

	test('one request at a time; edits made meanwhile go out once, with the latest content', async () => {
		const h = harness({ latency: 120 });
		h.edit('first');
		await sleep(DEBOUNCE + 10);
		expect(h.requests).toHaveLength(1);

		h.edit('second');
		await sleep(DEBOUNCE + 10);
		h.edit('third');
		await sleep(DEBOUNCE + 10);
		expect(h.requests).toHaveLength(1);

		await sleep(300);

		expect(h.maxInflight()).toBe(1);
		expect(h.requests.map((r) => r.payload)).toEqual(['first', 'third']);
	});

	test('the first save creates the draft once; later saves name it and the version read', async () => {
		const h = harness();
		h.edit('a');
		await sleep(DEBOUNCE + 30);
		h.edit('b');
		await sleep(DEBOUNCE + 30);

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
		await sleep(DEBOUNCE + 20);
		h.edit('x');
		h.edit('initial');
		await sleep(DEBOUNCE + 20);

		expect(h.requests).toHaveLength(0);
	});

	test('a conflict stops saving for good', async () => {
		const h = harness({ answer: () => ({ ok: false, conflict: true }) });
		h.edit('a');
		await sleep(DEBOUNCE + 20);
		h.edit('b');
		await sleep(DEBOUNCE + 20);
		h.autosave.resume();
		await h.autosave.flush();

		expect(h.requests).toHaveLength(1);
		expect(h.statuses.at(-1)).toBe('conflict');
	});

	test('a failure is shown and retried later', async () => {
		let fail = true;
		const h = harness({
			answer: (request) =>
				fail
					? { ok: false, conflict: false }
					: { ok: true, id: 'draft-1', version: request.version + 1, updatedAt: new Date() }
		});
		h.edit('a');
		await sleep(DEBOUNCE + 20);
		expect(h.statuses).toEqual(['saving', 'failed']);

		fail = false;
		await sleep(RETRY + 30);

		expect(h.requests.map((r) => r.payload)).toEqual(['a', 'a']);
		expect(h.statuses.at(-1)).toBe('saved');
	});

	test('stop drops the pending save and waits for the one in flight', async () => {
		const h = harness({ latency: 60 });
		h.edit('a');
		await sleep(DEBOUNCE + 10);
		h.edit('b');

		await h.autosave.stop();
		expect(h.autosave.id).toBe('draft-1');
		await sleep(DEBOUNCE + 80);
		expect(h.requests.map((r) => r.payload)).toEqual(['a']);

		// A refused submission resumes, and the dropped change is saved after all.
		h.autosave.resume();
		await sleep(DEBOUNCE + 80);
		expect(h.requests.map((r) => r.payload)).toEqual(['a', 'b']);
	});

	test('flush sends at once and asks for keepalive only for a small body', async () => {
		const h = harness();
		h.edit('small');
		await h.autosave.flush(true);
		h.edit('x'.repeat(70_000));
		await h.autosave.flush(true);

		expect(h.requests.map((r) => r.keepalive)).toEqual([true, false]);
	});

	test('after leave nothing more is reported', async () => {
		const h = harness({ latency: 30 });
		h.edit('a');
		h.autosave.leave();
		await sleep(60);

		expect(h.requests.map((r) => r.payload)).toEqual(['a']);
		expect(h.created).toEqual([]);
		expect(h.statuses).toEqual(['saving']);
	});
});
