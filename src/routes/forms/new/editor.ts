import { nanoid } from 'nanoid';
import { SHADOW_ITEM_MARKER_PROPERTY_NAME } from 'svelte-dnd-action';
import type { DraftQuestion } from '$lib/form-draft';
import { hasOptions, type QuestionType } from '$lib/forms';

// svelte-dnd-action identifies items by an `id` property, so the draft key is named for it.
// Answers point at these option ids, so reordering must never mint new ones.
export type EditorOption = { id: string; label: string };

export type EditorQuestion = {
	id: string;
	type: QuestionType;
	label: string;
	helpText: string;
	required: boolean;
	options: EditorOption[];
	allowOther: boolean;
};

// Shared by the zones and the items so the gap and the cards move together.
export const FLIP_MS = 150;

export const newOption = (): EditorOption => ({ id: nanoid(10), label: '' });

export function newQuestion(): EditorQuestion {
	return {
		id: nanoid(8),
		type: 'single',
		label: '',
		helpText: '',
		required: true,
		options: [newOption()],
		allowOther: false
	};
}

// A choice question always keeps one option to type into, as the editor's own buttons do.
export const fromSaved = (q: DraftQuestion): EditorQuestion => ({
	...q,
	id: nanoid(8),
	options:
		hasOptions(q.type) && q.options.length === 0
			? [newOption()]
			: q.options.map((option) => ({ ...option }))
});

export const cloneQuestions = (items: EditorQuestion[]): EditorQuestion[] =>
	items.map((q) => ({ ...q, options: q.options.map((option) => ({ ...option })) }));

// A drag swaps a placeholder into the list until it is dropped, and a snapshot taken then would
// bake that placeholder into history. Looking for the marker beats tracking a flag: a keyboard
// drop ends with a `consider`, so a flag cleared on `finalize` would never come back down.
const marked = (item: object) => SHADOW_ITEM_MARKER_PROPERTY_NAME in item;

export const midDrag = (questions: EditorQuestion[]) =>
	questions.some((q) => marked(q) || q.options.some(marked));
