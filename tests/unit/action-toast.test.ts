import { describe, expect, test } from 'bun:test';
import { toastOf } from '../../src/lib/action-toast';

describe('toastOf', () => {
	test('a notice is a success and a message an error', () => {
		expect(toastOf({ notice: '保存しました' })).toEqual({ kind: 'success', text: '保存しました' });
		expect(toastOf({ reason: 'stale', message: '先に保存されました' })).toEqual({
			kind: 'error',
			text: '先に保存されました'
		});
	});

	test('an input error with no place to show it is an error toast', () => {
		const result = { inputError: { message: 'フォームが大きすぎます', at: null } };
		expect(toastOf(result)).toEqual({ kind: 'error', text: 'フォームが大きすぎます' });
	});

	test('an input error with a field or question stays beside it', () => {
		expect(
			toastOf({ inputError: { message: '入力してください', at: { field: 'title' } } })
		).toBeNull();
		expect(toastOf({ inputError: { message: '不正です', at: { question: 0 } } })).toBeNull();
		expect(toastOf({ inputError: { message: '不正です', at: { questionId: 3 } } })).toBeNull();
	});

	test('a result with nothing to say draws nothing', () => {
		expect(toastOf(null)).toBeNull();
		expect(toastOf({ reason: 'closed' })).toBeNull();
		expect(toastOf({ created: true })).toBeNull();
	});
});
