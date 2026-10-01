/**
 * The saved state of the form editor. Shared by the editor, which writes it, and the server,
 * which stores it unchecked and reads it back into the editor's starting state.
 */

import {
	hasOptions,
	MAX_FORM_BYTES,
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
 * Upper bound on a draft request body, in UTF-8 bytes like MAX_FORM_BYTES.
 *
 * A draft carries the title, description and questions field that MAX_FORM_BYTES counts, each as a
 * JSON string. Escaping at most doubles a byte (a quote in the questions JSON becomes \"), so the
 * draft of any form within the limit stays within twice it. The other fields and the JSON around
 * them take well under the 10,000 added. The body is JSON, sent without percent-encoding.
 */
export const MAX_DRAFT_BYTES = 2 * MAX_FORM_BYTES + 10_000;

export type DraftOption = { id: string; label: string };

export type DraftQuestion = {
	/** The published question this one edits. Null for a question the form does not have yet. */
	sourceId: number | null;
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
	announceClose: boolean;
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

const questionId = (value: unknown): number | null =>
	typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

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
			sourceId: questionId(entry.sourceId),
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
		// Always present since it was added, as 'on' or 'off'. Older drafts fall back to on.
		announceClose: field('announceClose') !== 'off',
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

/** The editor's hidden `questions` field, as the create and publish actions parse it. */
export function questionsField(questions: DraftQuestion[]): string {
	return JSON.stringify(
		questions.map((q) => ({
			sourceId: q.sourceId,
			type: q.type,
			label: q.label,
			helpText: q.helpText,
			required: q.required,
			options: hasOptions(q.type) ? q.options : null,
			allowOther: hasOptions(q.type) && q.allowOther
		}))
	);
}
