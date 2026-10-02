import { describe, expect, test } from 'bun:test';
import { canSubmit, canViewResults, closesAtPassed, isClosed } from '$lib/server/forms';
import type { Visibility } from '$lib/forms';

const NOW = new Date('2026-06-01T12:00:00Z');
const PAST = new Date('2026-06-01T11:00:00Z');
const FUTURE = new Date('2026-06-01T13:00:00Z');
const ROLE = 'role-target';

describe('canSubmit', () => {
	test('everyone admits any member, with or without the target role', () => {
		const target = { submitScope: 'everyone', targetRoleId: ROLE } as const;
		expect(canSubmit(target, { roleIds: [] })).toBe(true);
		expect(canSubmit(target, { roleIds: [ROLE] })).toBe(true);
	});

	test('target_role admits only holders of the target role', () => {
		const target = { submitScope: 'target_role', targetRoleId: ROLE } as const;
		expect(canSubmit(target, { roleIds: [ROLE, 'other'] })).toBe(true);
		expect(canSubmit(target, { roleIds: ['other'] })).toBe(false);
		expect(canSubmit(target, { roleIds: [] })).toBe(false);
	});

	test('no role admits any member, whatever submitScope says', () => {
		for (const submitScope of ['everyone', 'target_role'] as const) {
			const target = { submitScope, targetRoleId: null };
			expect(canSubmit(target, { roleIds: [] })).toBe(true);
			expect(canSubmit(target, { roleIds: ['other'] })).toBe(true);
		}
	});
});

describe('closesAtPassed / isClosed', () => {
	test('closesAtPassed is inclusive of the closing instant', () => {
		expect(closesAtPassed({ closesAt: null }, NOW)).toBe(false);
		expect(closesAtPassed({ closesAt: FUTURE }, NOW)).toBe(false);
		expect(closesAtPassed({ closesAt: NOW }, NOW)).toBe(true);
		expect(closesAtPassed({ closesAt: PAST }, NOW)).toBe(true);
	});

	test('isClosed: a recorded close or a passed closes_at', () => {
		expect(isClosed({ closedAt: null, closesAt: null }, NOW)).toBe(false);
		expect(isClosed({ closedAt: null, closesAt: FUTURE }, NOW)).toBe(false);
		expect(isClosed({ closedAt: null, closesAt: PAST }, NOW)).toBe(true);
		expect(isClosed({ closedAt: PAST, closesAt: null }, NOW)).toBe(true);
		expect(isClosed({ closedAt: PAST, closesAt: FUTURE }, NOW)).toBe(true);
	});
});

describe('canViewResults', () => {
	const form = (
		visibility: Visibility,
		times: { deadline?: Date | null; closesAt?: Date | null; closedAt?: Date | null } = {}
	) => ({
		visibility,
		deadline: times.deadline ?? null,
		closesAt: times.closesAt ?? null,
		closedAt: times.closedAt ?? null
	});

	test('managers see every visibility', () => {
		for (const visibility of ['public', 'admin_only', 'after_deadline'] as const) {
			expect(canViewResults(form(visibility), true, NOW)).toBe(true);
		}
	});

	test('public is open to members, admin_only never is', () => {
		expect(canViewResults(form('public'), false, NOW)).toBe(true);
		expect(
			canViewResults(form('admin_only', { deadline: PAST, closedAt: PAST }), false, NOW)
		).toBe(false);
	});

	test('after_deadline stays hidden while open and before the deadline', () => {
		expect(canViewResults(form('after_deadline'), false, NOW)).toBe(false);
		expect(canViewResults(form('after_deadline', { deadline: FUTURE }), false, NOW)).toBe(false);
		expect(
			canViewResults(form('after_deadline', { deadline: FUTURE, closesAt: FUTURE }), false, NOW)
		).toBe(false);
	});

	test('after_deadline opens once the deadline passes', () => {
		expect(canViewResults(form('after_deadline', { deadline: PAST }), false, NOW)).toBe(true);
		expect(canViewResults(form('after_deadline', { deadline: NOW }), false, NOW)).toBe(true);
	});

	test('after_deadline opens when a form without a deadline is closed', () => {
		expect(canViewResults(form('after_deadline', { closedAt: PAST }), false, NOW)).toBe(true);
	});

	test('after_deadline opens when closed before the deadline', () => {
		expect(
			canViewResults(form('after_deadline', { deadline: FUTURE, closedAt: PAST }), false, NOW)
		).toBe(true);
	});

	test('after_deadline opens once closes_at passes, before the close is recorded', () => {
		expect(
			canViewResults(form('after_deadline', { deadline: FUTURE, closesAt: PAST }), false, NOW)
		).toBe(true);
		expect(canViewResults(form('after_deadline', { closesAt: PAST }), false, NOW)).toBe(true);
	});
});
