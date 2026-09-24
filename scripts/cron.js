// Entry point for Coolify Scheduled Tasks, which run inside the app container: node is there, curl is not.
// Usage: node scripts/cron.js <tick|sync-members>

// Under both Coolify's default 300 s task timeout and the 300 s headers timeout built into
// Node's fetch. Aborting only stops the wait; the pass on the server runs to completion.
const TIMEOUT_MS = 240_000;

const job = process.argv[2];
if (!job) {
	console.error('usage: node scripts/cron.js <job>');
	process.exit(2);
}

const secret = process.env.CRON_SECRET;
if (!secret) {
	console.error('CRON_SECRET is not set');
	process.exit(1);
}

// CRON_HOST exists for the Vite dev server, which listens on localhost and may bind only ::1.
const host = process.env.CRON_HOST || '127.0.0.1';
const url = `http://${host}:${process.env.PORT || 3000}/internal/cron/${encodeURIComponent(job)}`;

let response;
try {
	response = await fetch(url, {
		method: 'POST',
		headers: { authorization: `Bearer ${secret}`, accept: 'application/json' },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
} catch (cause) {
	console.error(`${job}: request failed`, cause);
	process.exit(1);
}

const body = await response.text();
console.log(body);

if (!response.ok) {
	console.error(`${job}: HTTP ${response.status}`);
	process.exit(1);
}

let failed = [];
try {
	failed = JSON.parse(body).failed ?? [];
} catch {
	console.error(`${job}: response is not JSON`);
	process.exit(1);
}

if (failed.length > 0) {
	console.error(`${job}: ${failed.length} failed`);
	process.exit(1);
}
