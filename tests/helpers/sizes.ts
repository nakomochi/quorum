import { questionsField, type DraftQuestion } from '../../src/lib/form-draft';
import {
	MAX_DESCRIPTION,
	MAX_HELP_TEXT,
	MAX_LABEL,
	MAX_OPTION_LABEL,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MAX_TITLE,
	utf8Bytes
} from '../../src/lib/forms';

export type FormText = { title: string; description: string; questions: string };

export const formTextBytes = (text: FormText) =>
	utf8Bytes(text.title) + utf8Bytes(text.description) + utf8Bytes(text.questions);

/**
 * The editor's title, description and questions field adding up to exactly `bytes`, every text
 * made of `char` and within its own limit, as the editor would post them. The last few bytes are
 * ASCII padding in the help texts. The title is left half empty, so that it can take more.
 */
export function formOfSize(bytes: number, char = 'あ'): FormText {
	const fill = (n: number) => char.repeat(n);
	const title = fill(MAX_TITLE / 2);
	const description = fill(MAX_DESCRIPTION);
	const questions: DraftQuestion[] = [];
	const text = (): FormText => ({ title, description, questions: questionsField(questions) });

	const newQuestion = (): DraftQuestion => ({
		type: 'single',
		label: fill(MAX_LABEL),
		helpText: '',
		required: true,
		options: [],
		allowOther: true
	});
	const newOption = (q: number, o: number) => ({
		id: `${q}-${o}`.padEnd(10, 'x'),
		label: fill(MAX_OPTION_LABEL)
	});

	for (;;) {
		let last = questions.at(-1);
		if (!last || last.options.length === MAX_OPTIONS) {
			if (questions.length === MAX_QUESTIONS) break;
			last = newQuestion();
			questions.push(last);
		}
		last.options.push(newOption(questions.length - 1, last.options.length));
		if (formTextBytes(text()) > bytes) {
			last.options.pop();
			if (last.options.length === 0) questions.pop();
			break;
		}
	}

	let gap = bytes - formTextBytes(text());
	for (const q of questions) {
		const pad = Math.min(gap, MAX_HELP_TEXT);
		q.helpText = 'a'.repeat(pad);
		gap -= pad;
	}
	if (gap !== 0) throw new Error(`cannot pad the form to ${bytes} bytes`);

	return text();
}
