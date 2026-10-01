/**
 * The saved state of the answer form. Shared by the page, which writes it from the form's fields,
 * and the server, which stores it unchecked and reads it back into the page's starting answers.
 *
 * A draft has the shape of a submitted revision (question id to AnswerValue), so that the page
 * restores it with the same code that shows a submitted answer and sameAnswers compares the two.
 * Unlike a submission, it keeps what the fields hold untrimmed and unchecked.
 */

import {
	liveOptions,
	MAX_RESPONSE_BYTES,
	OTHER_OPTION_ID,
	sameAnswers,
	type AnswerValue,
	type QuestionType,
	type RevisionAnswers
} from './forms';

/**
 * Upper bound on a draft request body, in UTF-8 bytes like MAX_RESPONSE_BYTES.
 *
 * A draft carries the same strings MAX_RESPONSE_BYTES counts, each as a JSON string. Escaping
 * grows a byte at most sixfold: a control character other than \b \f \n \r \t becomes \u00XX.
 * The structure around the strings (question keys, types, quotes and commas) is bounded by
 * MAX_QUESTIONS and MAX_OPTIONS: under 100 bytes per question and 3 per chosen option, about
 * 25,000 in all, which the 50,000 added covers. The sum stays within adapter-node's 512K body.
 */
export const MAX_RESPONSE_DRAFT_BYTES = 6 * MAX_RESPONSE_BYTES + 50_000;

export type DraftQuestion = {
	id: number;
	type: QuestionType;
	options: { id: string; deleted?: boolean }[] | null;
	allowOther: boolean;
};

/**
 * What the answer form's fields hold, as the page sends it. A question left blank has no entry,
 * and "その他" text is kept only while its choice is picked, as a submission would.
 */
export function answersFromFields(
	data: FormData,
	questions: Pick<DraftQuestion, 'id' | 'type'>[]
): RevisionAnswers {
	const answers: RevisionAnswers = {};
	for (const q of questions) {
		const values = data
			.getAll(`q_${q.id}`)
			.filter((value): value is string => typeof value === 'string' && value !== '');
		const rawOther = data.get(`q_${q.id}_other`);
		const other = typeof rawOther === 'string' ? rawOther : '';
		const first = values[0];
		if (first === undefined) continue;

		let value: AnswerValue;
		switch (q.type) {
			case 'single':
				value =
					first === OTHER_OPTION_ID ? { type: 'single', other } : { type: 'single', optionId: first };
				break;
			case 'multi': {
				const optionIds = [...new Set(values)].filter((id) => id !== OTHER_OPTION_ID);
				value = values.includes(OTHER_OPTION_ID)
					? { type: 'multi', optionIds, other }
					: { type: 'multi', optionIds };
				break;
			}
			case 'text':
				value = { type: 'text', text: first };
				break;
			case 'date':
				value = { type: 'date', date: first };
				break;
		}
		answers[String(q.id)] = value;
	}
	return answers;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function readValue(raw: unknown, q: DraftQuestion): AnswerValue | null {
	if (!isRecord(raw) || raw.type !== q.type) return null;
	const known = new Set(liveOptions(q.options).map((option) => option.id));
	const other = q.allowOther && typeof raw.other === 'string' ? raw.other : undefined;

	switch (q.type) {
		case 'single':
			if (typeof raw.optionId === 'string' && known.has(raw.optionId)) {
				return { type: 'single', optionId: raw.optionId };
			}
			return other === undefined ? null : { type: 'single', other };
		case 'multi': {
			const ids = Array.isArray(raw.optionIds) ? raw.optionIds : [];
			const optionIds = [
				...new Set(ids.filter((id): id is string => typeof id === 'string' && known.has(id)))
			];
			if (other !== undefined) return { type: 'multi', optionIds, other };
			return optionIds.length > 0 ? { type: 'multi', optionIds } : null;
		}
		case 'text':
			return typeof raw.text === 'string' ? { type: 'text', text: raw.text } : null;
		case 'date':
			return typeof raw.date === 'string' ? { type: 'date', date: raw.date } : null;
	}
}

/**
 * Stored drafts are never validated, so only what fits today's questions is read back: an entry
 * for a removed question, a mismatched type or an unknown or deleted option is dropped. Also what
 * a submitted answer or an older revision becomes when it is put back into the form.
 */
export function readResponseDraft(raw: unknown, questions: DraftQuestion[]): RevisionAnswers {
	const stored = isRecord(raw) ? raw : {};
	const answers: RevisionAnswers = {};
	for (const q of questions) {
		const value = readValue(stored[String(q.id)], q);
		if (value) answers[String(q.id)] = value;
	}
	return answers;
}

/** A draft value as a submission would store it: trimmed, and absent once blank. */
function settleValue(value: AnswerValue): AnswerValue | null {
	switch (value.type) {
		case 'single':
			return 'other' in value ? { type: 'single', other: value.other.trim() } : value;
		case 'multi':
			return value.other === undefined
				? value.optionIds.length > 0
					? value
					: null
				: { type: 'multi', optionIds: value.optionIds, other: value.other.trim() };
		case 'text': {
			const text = value.text.trim();
			return text ? { type: 'text', text } : null;
		}
		case 'date': {
			const date = value.date.trim();
			return date ? { type: 'date', date } : null;
		}
	}
}

/**
 * Whether a draft says anything the submitted answers do not. Whitespace a submission would trim
 * away is no change. An empty "その他" still is: it differs from anything that could be sent.
 */
export function draftDiffers(draft: RevisionAnswers, submitted: RevisionAnswers): boolean {
	const settled: RevisionAnswers = {};
	for (const [key, value] of Object.entries(draft)) {
		const next = settleValue(value);
		if (next) settled[key] = next;
	}
	return !sameAnswers(settled, submitted);
}
