// Every date this app shows or parses is Asia/Tokyo, regardless of the server's TZ or the
// viewer's browser. Japan has no daylight saving time, so a fixed +09:00 offset is exact.

const JST_OFFSET = '+09:00';

const LOCAL_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const displayFormat = new Intl.DateTimeFormat('ja-JP', {
	dateStyle: 'short',
	timeStyle: 'short',
	timeZone: 'Asia/Tokyo'
});

const timeFormat = new Intl.DateTimeFormat('ja-JP', {
	timeStyle: 'short',
	timeZone: 'Asia/Tokyo'
});

const inputFormat =new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Asia/Tokyo',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

/**
 * Parses an `<input type="datetime-local">` value as JST. Passing the bare string to `new Date`
 * would resolve it against the process TZ instead, which is UTC in production.
 */
export function parseJstLocal(value: string): Date | null {
	const match = LOCAL_PATTERN.exec(value.trim());
	if (!match) return null;

	const [, date, hour, minute, second] = match;
	const parsed = new Date(`${date}T${hour}:${minute}:${second ?? '00'}${JST_OFFSET}`);
	if (Number.isNaN(parsed.getTime())) return null;

	// The native parser rolls out-of-range values over instead of rejecting them: 2026-02-30
	// becomes March 2, and T24:00 becomes the next midnight. Round-trip to catch that.
	return toJstLocal(parsed) === `${date}T${hour}:${minute}` ? parsed : null;
}

export function formatJst(value: Date | null, fallback = '—'): string {
	return value ? displayFormat.format(value) : fallback;
}

/** Hours and minutes only, for something that happened moments ago. */
export function formatJstTime(value: Date): string {
	return timeFormat.format(value);
}

/** JST value for an `<input type="datetime-local">`. */
export function toJstLocal(value: Date): string {
	const parts = new Map(inputFormat.formatToParts(value).map((part) => [part.type, part.value]));
	return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}`;
}
