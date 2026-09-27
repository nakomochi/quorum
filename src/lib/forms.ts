/** Shared between the server modules and the question editor, which cannot import $lib/server. */

export const QUESTION_TYPES = ['single', 'multi', 'text', 'date'] as const;
export const SUBMIT_SCOPES = ['everyone', 'target_role'] as const;
export const VISIBILITIES = ['public', 'admin_only', 'after_deadline'] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type SubmitScope = (typeof SUBMIT_SCOPES)[number];
export type Visibility = (typeof VISIBILITIES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
	single: '単一選択',
	multi: '複数選択',
	text: '自由記述',
	date: '日付'
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
	public: '全員に公開',
	admin_only: '管理者のみ',
	after_deadline: '締切後に公開'
};

export const hasOptions = (type: QuestionType) => type === 'single' || type === 'multi';

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 4000;
export const MAX_LABEL = 500;
export const MAX_HELP_TEXT = 1000;
export const MAX_OPTION_LABEL = 200;
export const MAX_OPTION_ID = 64;
export const MAX_QUESTIONS = 100;
export const MAX_OPTIONS = 50;
export const MAX_TEXT_ANSWER = 4000;
export const MAX_OTHER_ANSWER = 500;

/** Posted as the choice value for "その他"; option ids may never take it. */
export const OTHER_OPTION_ID = '__other__';

/**
 * Shapes saved before "その他" existed must stay valid as they are: `other` is only ever added,
 * never required, and a single answer carries either `optionId` or `other`, never both.
 */
export type AnswerValue =
	| { type: 'single'; optionId: string }
	| { type: 'single'; other: string }
	| { type: 'multi'; optionIds: string[]; other?: string }
	| { type: 'text'; text: string }
	| { type: 'date'; date: string };

type ChoiceLabel = { id: string; label: string };

export function describeAnswer(value: AnswerValue, options: ChoiceLabel[] | null): string {
	const labelOf = (id: string) => options?.find((option) => option.id === id)?.label ?? id;
	const other = (text: string) => `その他: ${text}`;
	switch (value.type) {
		case 'single':
			return 'other' in value ? other(value.other) : labelOf(value.optionId);
		case 'multi':
			return [
				...value.optionIds.map(labelOf),
				...(value.other === undefined ? [] : [other(value.other)])
			].join('、');
		case 'text':
			return value.text;
		case 'date':
			return value.date;
	}
}
