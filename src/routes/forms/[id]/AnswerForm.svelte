<script lang="ts" module>
	/** The id of a question's card, which the page scrolls to when the server refuses its answer. */
	export const questionAnchor = (questionId: number) => `question-${questionId}`;
</script>

<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Attachment } from 'svelte/attachments';
	import { enhance } from '$app/forms';
	import SaveStatus from '$lib/components/SaveStatus.svelte';
	import type { SaveStatus as DraftSaveStatus } from '$lib/draft-autosave';
	import type { AnswerValue, InputError } from '$lib/forms';
	import type { PageData } from './$types';
	import QuestionField from './QuestionField.svelte';

	type Props = {
		questions: PageData['questions'];
		/** The form's version the questions were read at, posted with the answers. */
		version: number;
		/** What the fields start from. They take it only when they are created. */
		source: Record<string, AnswerValue | undefined>;
		saveStatus: DraftSaveStatus;
		closed: boolean;
		/** An earlier submission exists: sending updates it, and editing can be cancelled. */
		submitted: boolean;
		submitting: boolean;
		/** The last submission's rejected input, until the next result. */
		inputError: InputError | null;
		submit: SubmitFunction;
		/** Attached to the form element. */
		attach: Attachment<HTMLFormElement>;
		/** Any input or change inside the form. */
		onedit: () => void;
		oncancel: () => void;
	};

	let {
		questions,
		version,
		source,
		saveStatus,
		closed,
		submitted,
		submitting,
		inputError,
		submit,
		attach,
		onedit,
		oncancel
	}: Props = $props();

	// One with no question to point at, such as a response too large as a whole, is a toast.
	const errorOf = (questionId: number) =>
		inputError?.at && 'questionId' in inputError.at && inputError.at.questionId === questionId
			? inputError.message
			: null;
</script>

<form
	method="POST"
	use:enhance={submit}
	{@attach attach}
	oninput={onedit}
	onchange={onedit}
	class="flex scroll-mt-4 flex-col gap-5"
>
	<input type="hidden" name="version" value={version} />
	{#each questions as q (q.id)}
		<QuestionField question={q} value={source[q.id]} error={errorOf(q.id)} id={questionAnchor(q.id)} />
	{/each}

	<SaveStatus
		status={saveStatus}
		savedLabel="下書きを保存済み"
		failedLabel="下書きを保存できませんでした"
		tooLargeHint="回答が大きすぎます。入力を短くしてください"
		conflictMessage="別の画面でこの回答が送信されたか、下書きが更新・破棄されました。この画面の自動保存は停止しています。"
	>
		<button type="submit" class="btn-primary px-5 py-2.5" disabled={submitting || closed}>
			{submitted ? '回答を更新' : '送信'}
		</button>
		{#if submitted}
			<button type="button" class="text-sm text-text-muted hover:underline" onclick={oncancel}>
				キャンセル
			</button>
		{/if}
	</SaveStatus>
</form>
