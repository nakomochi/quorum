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
	after_deadline: '締切後または確定後に公開'
};

export const hasOptions = (type: QuestionType) => type === 'single' || type === 'multi';

/**
 * The options a respondent may still choose. An option removed by an edit stays in the stored list
 * marked `deleted`, so that answers naming it keep their label.
 */
export const liveOptions = <T extends { deleted?: boolean }>(options: T[] | null): T[] =>
	(options ?? []).filter((option) => !option.deleted);

// Why an edit of a published form may not change a setting, shown beside it and sent by the server.
export const AUDIENCE_LOCKED = '回答があるため変更できません。複製して作り直してください';
export const TYPE_LOCKED = '回答があるため変更できません';
export const CHANNEL_LOCKED = 'Discord に投稿済みのため変更できません';

/** Beside the reopen button on the edit page, when the receiving end has passed. */
export const REOPEN_CLEARS_CLOSES_AT =
	'受付終了日時を過ぎているため、再開すると受付終了の設定は解除され、以後は手動で締め切るまで回答を受け付けます。';

/** Asked before a closed form is reopened, on the results page and the edit page. */
export const reopenConfirmation = (clearsClosesAt: boolean) =>
	clearsClosesAt
		? '対象者と未提出者の確定を破棄して受付を再開します。受付終了日時を過ぎているため、その設定は解除され、以後は手動で締め切るまで回答を受け付けます。元に戻せません。'
		: '対象者と未提出者の確定を破棄して受付を再開します。元に戻せません。';

/** How a form stands for its creator; the top page gets this instead of the times behind it. */
export type FormStatus = 'open' | 'ended' | 'closed';

export const FORM_STATUS_LABELS: Record<FormStatus, string> = {
	open: '受付中',
	ended: '受付終了',
	closed: '確定済み'
};

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

/**
 * Whole-form and whole-response limits, in UTF-8 bytes of the text as it arrives, before any
 * trimming. The per-field limits above add up to megabytes, far past the 512K request body that
 * adapter-node accepts by default. Form posts are URL-encoded, where one byte of text takes at
 * most three, so either limit stays well inside that body.
 *
 * The form counts its title, description and questions field; a response counts every value and
 * "その他" text sent for the form's questions.
 */
export const MAX_FORM_BYTES = 100_000;
export const MAX_RESPONSE_BYTES = 50_000;

const encoder = new TextEncoder();

export const utf8Bytes = (text: string) => encoder.encode(text).byteLength;

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

/** A whole submission as one revision saw it. jsonb object keys are strings, hence the key type. */
export type RevisionAnswers = Record<string, AnswerValue>;

// A multi answer's ids carry no order, so they are sorted before comparing.
function canonicalAnswer(value: AnswerValue): string {
	switch (value.type) {
		case 'single':
			return JSON.stringify(
				'other' in value ? ['single-other', value.other] : ['single', value.optionId]
			);
		case 'multi':
			return JSON.stringify(['multi', [...value.optionIds].sort(), value.other ?? null]);
		case 'text':
			return JSON.stringify(['text', value.text]);
		case 'date':
			return JSON.stringify(['date', value.date]);
	}
}

export function sameAnswer(a: AnswerValue | undefined, b: AnswerValue | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return canonicalAnswer(a) === canonicalAnswer(b);
}

export function sameAnswers(a: RevisionAnswers, b: RevisionAnswers): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [...keys].every((key) => sameAnswer(a[key], b[key]));
}

/** The form editor's fields, by the name they are posted under. */
export type FormField =
	| 'title'
	| 'description'
	| 'targetRoleId'
	| 'announcementChannelId'
	| 'submitScope'
	| 'visibility'
	| 'deadline'
	| 'closesAt';

/**
 * Where rejected input is shown: a creation or edit field, a question by its place in the posted list
 * (counted from 0), or an answered question by its id. Null for the form as a whole.
 */
export type InputErrorAt = { field: FormField } | { question: number } | { questionId: number };

/** What an action sends back for rejected input, drawn beside what it concerns. */
export type InputError = { message: string; at: InputErrorAt | null };

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
