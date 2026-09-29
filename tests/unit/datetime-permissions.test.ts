import { describe, expect, test } from 'bun:test';
import {
	formatJst,
	formatJstTime,
	formatJstWithYear,
	parseJstLocal,
	toJstLocal
} from '$lib/datetime';
import { ADMIN_PERMISSIONS, hasAdminPermissions, rolePermissions } from '$lib/server/permissions';

describe('formatJst / formatJstTime', () => {
	const IN_2025 = new Date('2025-06-01T03:00:00Z');

	test('pads the hour to two digits in 24-hour JST', () => {
		const cases: [string, string][] = [
			['2026-04-26T15:00:00Z', '2026/04/27 00:00'],
			['2026-04-27T00:05:00Z', '2026/04/27 09:05'],
			['2026-04-27T10:00:00Z', '2026/04/27 19:00'],
			['2026-04-27T14:59:00Z', '2026/04/27 23:59']
		];
		for (const [iso, expected] of cases) {
			expect(formatJst(new Date(iso), '—', IN_2025)).toBe(expected);
			expect(formatJstTime(new Date(iso))).toBe(expected.slice(-5));
		}
	});

	test('leaves the year out for this year only', () => {
		const now = new Date('2026-09-30T03:00:00Z');
		expect(formatJst(new Date('2026-10-13T19:00:00Z'), '—', now)).toBe('10/14 04:00');
		expect(formatJst(new Date('2025-10-13T19:00:00Z'), '—', now)).toBe('2025/10/14 04:00');
		expect(formatJst(new Date('2027-10-13T19:00:00Z'), '—', now)).toBe('2027/10/14 04:00');
	});

	test('judges the year in JST on both sides of New Year', () => {
		const lastMinute = new Date('2026-12-31T23:59:00+09:00');
		const firstMinute = new Date('2027-01-01T00:00:00+09:00');

		// Still 2026 in JST.
		expect(formatJst(lastMinute, '—', lastMinute)).toBe('12/31 23:59');
		expect(formatJst(firstMinute, '—', lastMinute)).toBe('2027/01/01 00:00');

		// 2027 in JST while UTC is still in 2026.
		expect(formatJst(lastMinute, '—', firstMinute)).toBe('2026/12/31 23:59');
		expect(formatJst(firstMinute, '—', firstMinute)).toBe('01/01 00:00');
		expect(formatJst(new Date('2026-12-31T15:30:00Z'), '—', new Date('2026-12-31T16:00:00Z'))).toBe(
			'01/01 00:30'
		);
	});

	test('falls back when there is no date', () => {
		expect(formatJst(null)).toBe('—');
		expect(formatJst(null, 'なし')).toBe('なし');
	});
});

describe('formatJstWithYear', () => {
	test('keeps the year for this year too, judged in JST', () => {
		const thisYear = new Date();
		expect(formatJstWithYear(new Date('2026-10-13T19:00:00Z'))).toBe('2026/10/14 04:00');
		expect(formatJstWithYear(thisYear)).toBe(formatJst(thisYear, '—', new Date('1999-06-01T00:00:00Z')));
		// 2027 in JST while UTC is still in 2026.
		expect(formatJstWithYear(new Date('2026-12-31T15:30:00Z'))).toBe('2027/01/01 00:30');
	});

	test('falls back when there is no date', () => {
		expect(formatJstWithYear(null)).toBe('—');
		expect(formatJstWithYear(null, '未設定')).toBe('未設定');
	});
});

describe('parseJstLocal', () => {
	test('reads a datetime-local value as JST', () => {
		expect(parseJstLocal('2026-09-29T09:00')?.toISOString()).toBe('2026-09-29T00:00:00.000Z');
		expect(parseJstLocal('2026-01-01T00:30')?.toISOString()).toBe('2025-12-31T15:30:00.000Z');
		expect(parseJstLocal('2026-09-29T09:00:30')?.toISOString()).toBe('2026-09-29T00:00:30.000Z');
		expect(parseJstLocal('  2026-09-29T09:00  ')?.toISOString()).toBe('2026-09-29T00:00:00.000Z');
	});

	test('rejects values the native parser would roll over', () => {
		expect(parseJstLocal('2026-02-30T10:00')).toBeNull();
		expect(parseJstLocal('2026-09-29T24:00')).toBeNull();
		expect(parseJstLocal('2026-13-01T10:00')).toBeNull();
		expect(parseJstLocal('2026-09-29T10:60')).toBeNull();
	});

	test('rejects anything but the datetime-local shape', () => {
		for (const value of ['', '2026-09-29', '2026-09-29 10:00', '2026-09-29T10:00Z', '2026-09-29T10:00+09:00', 'tomorrow']) {
			expect(parseJstLocal(value)).toBeNull();
		}
	});

	test('round-trips through toJstLocal', () => {
		expect(toJstLocal(parseJstLocal('2028-02-29T23:59')!)).toBe('2028-02-29T23:59');
	});
});

describe('rolePermissions / hasAdminPermissions', () => {
	const GUILD = '1000';
	const role = (id: string, permissions: bigint | string) => ({
		id,
		permissions: typeof permissions === 'bigint' ? permissions.toString() : permissions
	});

	test('@everyone applies to every member although Discord omits it from member.roles', () => {
		const roles = [role(GUILD, 0x20n)];
		expect(rolePermissions([], roles, GUILD)).toBe(0x20n);
		expect(hasAdminPermissions([], roles, GUILD)).toBe(true);
	});

	test('ADMINISTRATOR and MANAGE_GUILD each count as admin; other bits do not', () => {
		expect(hasAdminPermissions(['r'], [role('r', 0x8n)], GUILD)).toBe(true);
		expect(hasAdminPermissions(['r'], [role('r', 0x20n)], GUILD)).toBe(true);
		expect(hasAdminPermissions(['r'], [role('r', 0x10n | 0x2000n)], GUILD)).toBe(false);
		expect(ADMIN_PERMISSIONS).toBe(0x28n);
	});

	test('only roles the member holds contribute', () => {
		const roles = [role('held', 0x400n), role('not-held', 0x8n), role(GUILD, 0x1n)];
		expect(rolePermissions(['held'], roles, GUILD)).toBe(0x401n);
		expect(hasAdminPermissions(['held'], roles, GUILD)).toBe(false);
	});

	test('bitfields wider than 53 bits stay exact', () => {
		const wide = (1n << 50n) | (1n << 40n) | 1n;
		const roles = [role('a', wide), role('b', (1n << 53n) + 1n)];
		expect(rolePermissions(['a', 'b'], roles, GUILD)).toBe(wide | ((1n << 53n) + 1n));
		expect(hasAdminPermissions(['a', 'b'], roles, GUILD)).toBe(false);
		expect(hasAdminPermissions(['c'], [role('c', (1n << 50n) | 0x8n)], GUILD)).toBe(true);
	});
});
