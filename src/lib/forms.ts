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

export type AnswerValue =
	| { type: 'single'; optionId: string }
	| { type: 'multi'; optionIds: string[] }
	| { type: 'text'; text: string }
	| { type: 'date'; date: string };
