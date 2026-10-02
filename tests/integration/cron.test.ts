import { afterEach, describe, expect, test } from 'bun:test';
import { isHttpError } from '@sveltejs/kit';
import { POST } from '../../src/routes/internal/cron/[job]/+server';

const SECRET = 'cron-secret-for-tests';

function call(job: string, authorization?: string) {
	const headers = new Headers();
	if (authorization !== undefined) headers.set('authorization', authorization);
	const request = new Request(`http://forms.test/internal/cron/${job}`, {
		method: 'POST',
		headers
	});
	return POST({ params: { job }, request } as never);
}

async function statusOf(pending: Response | Promise<Response>): Promise<number> {
	try {
		return (await pending).status;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

afterEach(() => {
	delete process.env.CRON_SECRET;
});

describe('cron endpoint authorization', () => {
	test('refuses everything while CRON_SECRET is unset', async () => {
		delete process.env.CRON_SECRET;
		expect(await statusOf(call('tick'))).toBe(401);
		expect(await statusOf(call('tick', 'Bearer '))).toBe(401);
		expect(await statusOf(call('tick', 'Bearer undefined'))).toBe(401);
	});

	test('refuses everything while CRON_SECRET is empty', async () => {
		process.env.CRON_SECRET = '';
		expect(await statusOf(call('tick', 'Bearer '))).toBe(401);
	});

	test('refuses a wrong, partial or differently shaped secret', async () => {
		process.env.CRON_SECRET = SECRET;
		expect(await statusOf(call('tick'))).toBe(401);
		expect(await statusOf(call('tick', `Bearer ${SECRET}x`))).toBe(401);
		expect(await statusOf(call('tick', `Bearer ${SECRET.slice(0, -1)}`))).toBe(401);
		expect(await statusOf(call('tick', SECRET))).toBe(401);
		expect(await statusOf(call('tick', `bearer ${SECRET}`))).toBe(401);
	});

	test('checks the secret before the job name', async () => {
		process.env.CRON_SECRET = SECRET;
		expect(await statusOf(call('nope', 'Bearer wrong'))).toBe(401);
		expect(await statusOf(call('nope', `Bearer ${SECRET}`))).toBe(404);
	});

	test('runs the job for the right secret', async () => {
		process.env.CRON_SECRET = SECRET;
		const res = await call('tick', `Bearer ${SECRET}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ reminded: [], closed: [], closePosted: [], failed: [] });
	});
});
