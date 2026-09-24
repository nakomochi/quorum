import { createHash, timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isCronJob, runCronJob } from '$lib/server/scheduler';
import type { RequestHandler } from './$types';

function digest(value: string): Buffer {
	return createHash('sha256').update(value).digest();
}

function authorized(header: string | null): boolean {
	const secret = env.CRON_SECRET;
	// Fail closed: with no secret configured, `Bearer ` alone would otherwise match.
	if (!secret || !header) return false;
	// Hashed so both sides have the same length, which timingSafeEqual requires, without the
	// length check itself revealing how long the secret is.
	return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export const POST: RequestHandler = async ({ params, request }) => {
	if (!authorized(request.headers.get('authorization'))) error(401, 'unauthorized');

	const { job } = params;
	if (!isCronJob(job)) error(404, `unknown job: ${job}`);

	let result;
	try {
		result = await runCronJob(job);
	} catch (cause) {
		console.error(`cron job ${job} failed`, cause);
		error(500, `${job} failed`);
	}

	if (!result) error(409, `${job} is already running`);

	return json(result);
};
