import { describe, expect, test } from 'bun:test';
import { matchesQuery, searchKey } from '$lib/search';

describe('matchesQuery', () => {
	test('a substring anywhere in the name, whatever the case', () => {
		expect(matchesQuery('Staff-Only', 'only')).toBe(true);
		expect(matchesQuery('Staff-Only', 'STAFF')).toBe(true);
		expect(matchesQuery('Staff-Only', 'general')).toBe(false);
	});

	test('hiragana finds katakana and the other way round', () => {
		expect(matchesQuery('サポーター', 'さぽ')).toBe(true);
		expect(matchesQuery('ざつだん', 'ザツ')).toBe(true);
	});

	test('full- and half-width are the same, half-width katakana with its voicing mark included', () => {
		expect(matchesQuery('Ｄｉｓｃｏｒｄ管理', 'disc')).toBe(true);
		expect(matchesQuery('2026年度生', '２０２６')).toBe(true);
		expect(matchesQuery('ガイド', 'ｶﾞｲ')).toBe(true);
	});

	test('a blank query matches everything', () => {
		expect(matchesQuery('運営', '')).toBe(true);
		expect(matchesQuery('運営', '  ')).toBe(true);
	});
});

describe('searchKey', () => {
	test('folds to lower-case hiragana, leaving kanji and the long vowel mark alone', () => {
		expect(searchKey('サポーターＡ')).toBe('さぽーたーa');
		expect(searchKey('運営')).toBe('運営');
	});
});
