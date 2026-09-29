/**
 * The saved state of the form editor. Shared by the editor, which writes it, and the server,
 * which stores it unchecked and reads it back into the editor's starting state.
 */

import {
	hasOptions,
	MAX_DESCRIPTION,
	MAX_HELP_TEXT,
	MAX_LABEL,
	MAX_OPTION_ID,
	MAX_OPTION_LABEL,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MAX_TITLE,
	QUESTION_TYPES,
	SUBMIT_SCOPES,
	VISIBILITIES,
	type QuestionType,
	type SubmitScope,
	type Visibility
} from './forms';

export const DRAFT_FORMAT = 1;

/**
 * Version 1: every entry of the editor's FormData by field name, including the hidden `questions`
 * JSON, plus the editor state no field carries.
 */
export type FormDraftPayload = {
	v: typeof DRAFT_FORMAT;
	fields: Record<string, string[]>;
	closesAtTouched: boolean;
};

export function draftPayload(
	fields: Record<string, string[]>,
	closesAtTouched: boolean
): FormDraftPayload {
	return { v: DRAFT_FORMAT, fields, closesAtTouched };
}

/**
 * Upper bound on a draft request body, counted in UTF-16 code units like the MAX_* limits.
 *
 * Text a valid form can hold:
 *   title 200 + description 4,000
 *   + 100 questions × (label 500 + help 1,000 + 50 options × (label 200 + id 64)) = 1,474,200.
 * Structure: the questions JSON is nested in a string, so its quotes are escaped once more;
 *   about 30 per option and 120 per question, 100 × (120 + 50 × 30) = 162,000.
 * Together about 1.64M. Rounded up to 2M to leave room for escaped quotes, backslashes and
 * newlines in the text itself.
 */
export const DRAFT_TEXT_LIMIT =
	MAX_TITLE +
	MAX_DESCRIPTION +
	MAX_QUESTIONS * (MAX_LABEL + MAX_HELP_TEXT + MAX_OPTIONS * (MAX_OPTION_LABEL + MAX_OPTION_ID));

export const MAX_DRAFT_LENGTH = 2_000_000;

/** A UTF-16 code unit takes at most 3 bytes in UTF-8, so no longer body can fit the limit. */
export const MAX_DRAFT_BYTES = MAX_DRAFT_LENGTH * 3;

export type DraftOption = { id: string; label: string };

export type DraftQuestion = {
	type: QuestionType;
	label: string;
	helpText: string;
	required: boolean;
	options: DraftOption[];
	allowOther: boolean;
};

/** What the editor starts from. Every field has a usable value whatever was stored. */
export type EditorState = {
	title: string;
	description: string;
	targetRoleId: string;
	announcementChannelId: string;
	submitScope: SubmitScope;
	visibility: Visibility;
	deadline: string;
	closesAt: string;
	allowEdit: boolean;
	closesAtTouched: boolean;
	questions: DraftQuestion[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
	return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readOptions(raw: unknown): DraftOption[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const options: DraftOption[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const id = text(entry.id);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		options.push({ id, label: text(entry.label) });
	}
	return options;
}

function readQuestions(raw: string): DraftQuestion[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	return parsed.filter(isRecord).map((entry) => {
		const type = pick(text(entry.type), QUESTION_TYPES, 'single');
		return {
			type,
			label: text(entry.label),
			helpText: text(entry.helpText),
			required: entry.required === true,
			options: readOptions(entry.options),
			allowOther: hasOptions(type) && entry.allowOther === true
		};
	});
}

/** Stored drafts are never validated, so anything unreadable falls back to the editor's default. */
export function readDraftPayload(payload: unknown): EditorState {
	const record = isRecord(payload) ? payload : {};
	const readable = isRecord(record.fields);
	const fields = readable ? (record.fields as Record<string, unknown>) : {};
	const field = (name: string): string | null => {
		const values = fields[name];
		return Array.isArray(values) && typeof values[0] === 'string' ? values[0] : null;
	};

	return {
		title: field('title') ?? '',
		description: field('description') ?? '',
		targetRoleId: field('targetRoleId') ?? '',
		announcementChannelId: field('announcementChannelId') ?? '',
		submitScope: pick(field('submitScope') ?? '', SUBMIT_SCOPES, 'everyone'),
		visibility: pick(field('visibility') ?? '', VISIBILITIES, 'public'),
		deadline: field('deadline') ?? '',
		closesAt: field('closesAt') ?? '',
		// An unchecked box is absent from FormData, so only an unreadable draft falls back to on.
		allowEdit: readable ? field('allowEdit') !== null : true,
		closesAtTouched: record.closesAtTouched === true,
		questions: readQuestions(field('questions') ?? '')
	};
}

/** The editor's hidden `questions` field, as the create action parses it. */
export function questionsField(questions: DraftQuestion[]): string {
	return JSON.stringify(
		questions.map((q) => ({
			type: q.type,
			label: q.label,
			helpText: q.helpText,
			required: q.required,
			options: hasOptions(q.type) ? q.options : null,
			allowOther: hasOptions(q.type) && q.allowOther
		}))
	);
}
