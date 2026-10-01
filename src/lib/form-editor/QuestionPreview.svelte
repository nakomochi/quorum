<script lang="ts">
	import { dragHandle } from 'svelte-dnd-action';
	import RequiredMark from '$lib/components/RequiredMark.svelte';
	import { hasOptions, QUESTION_TYPE_LABELS } from '$lib/forms';
	import Icon from '$lib/icons/Icon.svelte';
	import type { EditorQuestion } from './editor';

	type Props = {
		question: EditorQuestion;
		/** The question's place in the list, counted from 0. */
		index: number;
		/** Why the server refused this question. */
		error: string | null;
		/** Opens the card for editing. */
		onselect: () => void;
	};

	let { question, index, error, onselect }: Props = $props();
</script>

<!-- A closed card, drawn about as a respondent sees it. Like QuestionCard, it fills the frame the
     list draws. -->
<div
	use:dragHandle
	aria-label="質問 {index + 1} をドラッグして並び替え"
	class="outline-accent -mx-5 -mt-5 flex touch-none justify-center rounded-t-xl py-2 text-text-muted hover:text-text-subtle focus-visible:-outline-offset-2 focus-visible:outline-2"
>
	<Icon name="grip-horizontal" />
</div>

<!-- The rest of the card is one button, so that a click anywhere, or Enter / Space, opens it.
     A button may hold phrasing content only, hence the spans. -->
<button
	type="button"
	onclick={onselect}
	class="outline-accent hover:bg-surface-alt -mx-5 -mt-3 -mb-5 flex cursor-pointer flex-col gap-3 rounded-b-xl px-5 pt-3 pb-5 text-left focus-visible:-outline-offset-2 focus-visible:outline-2"
>
	<span class="flex items-center justify-between gap-2 text-xs text-text-muted">
		<span>質問 {index + 1}</span>
		<span>{QUESTION_TYPE_LABELS[question.type]}</span>
	</span>

	<!-- Plain text, not an alert: a button's content is read as its name, roles and all dropped.
	     A submission that fails here opens the card, where the message is an alert. -->
	{#if error}
		<span class="text-danger text-xs">{error}</span>
	{/if}

	<span class="flex flex-col gap-1">
		<span class="text-sm font-medium">
			{#if question.label}
				{question.label}
			{:else}
				<span class="font-normal text-text-muted">無題の質問</span>
			{/if}
			{#if question.required}<RequiredMark />{/if}
		</span>
		{#if question.helpText}
			<span class="text-xs text-text-muted">{question.helpText}</span>
		{/if}
	</span>

	{#if hasOptions(question.type)}
		{@const mark = [
			'border-input-border size-4 shrink-0 border',
			question.type === 'single' ? 'rounded-full' : 'rounded-sm'
		]}
		<span class="flex flex-col gap-2">
			{#each question.options as option (option.id)}
				<span class="flex items-center gap-2 text-sm">
					<span class={mark}></span>
					{#if option.label}
						<span class="min-w-0">{option.label}</span>
					{:else}
						<span class="text-text-muted">無題の選択肢</span>
					{/if}
				</span>
			{/each}
			{#if question.allowOther}
				<span class="flex items-center gap-2 text-sm">
					<span class={mark}></span>
					<span class="text-text-muted">その他…</span>
				</span>
			{/if}
		</span>
	{/if}
</button>
