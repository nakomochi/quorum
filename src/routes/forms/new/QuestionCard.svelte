<script lang="ts">
	import { dragHandle } from 'svelte-dnd-action';
	import {
		hasOptions,
		MAX_HELP_TEXT,
		MAX_LABEL,
		QUESTION_TYPE_LABELS,
		QUESTION_TYPES,
		type QuestionType
	} from '$lib/forms';
	import Icon from '$lib/icons/Icon.svelte';
	import { newOption, type EditorQuestion } from './editor';
	import type { HistoryControls } from './history.svelte';
	import OptionList from './OptionList.svelte';

	type Props = {
		question: EditorQuestion;
		/** The question's place in the list, counted from 0. */
		index: number;
		/** How many questions the list holds. */
		count: number;
		history: HistoryControls;
		/** Swaps the question with its neighbour: -1 above, 1 below. */
		onmove: (delta: number) => void;
		onremove: () => void;
	};

	let { question = $bindable(), index, count, history, onmove, onremove }: Props = $props();

	function onTypeChange(type: QuestionType) {
		history.step(() => {
			question.type = type;
			if (hasOptions(type) && question.options.length === 0) question.options = [newOption()];
			if (!hasOptions(type)) question.allowOther = false;
		});
	}
</script>

<!-- The card's frame is the list's: animate:flip has to sit on the element the each block draws. -->
<div
	use:dragHandle
	aria-label="質問 {index + 1} をドラッグして並び替え"
	class="outline-accent -mx-5 -mt-5 flex touch-none justify-center rounded-t-xl py-2 text-text-muted hover:text-text-subtle focus-visible:-outline-offset-2 focus-visible:outline-2"
>
	<Icon name="grip-horizontal" />
</div>

<div class="flex items-center justify-between gap-2">
	<span class="text-xs text-text-muted">質問 {index + 1}</span>
	<div class="flex gap-1">
		<button
			type="button"
			class="chip p-1.5"
			aria-label="質問 {index + 1} を上へ移動"
			disabled={index === 0}
			onclick={() => onmove(-1)}
		>
			<Icon name="chevron-up" />
		</button>
		<button
			type="button"
			class="chip p-1.5"
			aria-label="質問 {index + 1} を下へ移動"
			disabled={index === count - 1}
			onclick={() => onmove(1)}
		>
			<Icon name="chevron-down" />
		</button>
		<!-- The server rejects an empty question set, so the last one must stay. -->
		<button
			type="button"
			class="chip"
			aria-label="質問 {index + 1} を削除"
			disabled={count === 1}
			onclick={onremove}
		>
			削除
		</button>
	</div>
</div>

<div class="grid gap-3 sm:grid-cols-[1fr_10rem]">
	<input
		bind:value={question.label}
		aria-label="質問 {index + 1} の質問文"
		placeholder="質問文"
		required
		maxlength={MAX_LABEL}
		class="field"
	/>
	<select
		value={question.type}
		aria-label="質問 {index + 1} の種類"
		onchange={(event) => onTypeChange(event.currentTarget.value as QuestionType)}
		class="field"
	>
		{#each QUESTION_TYPES as type (type)}
			<option value={type}>{QUESTION_TYPE_LABELS[type]}</option>
		{/each}
	</select>
</div>

<input
	bind:value={question.helpText}
	aria-label="質問 {index + 1} の補足"
	placeholder="補足（任意）"
	maxlength={MAX_HELP_TEXT}
	class="field"
/>

<label class="flex items-center gap-2 text-sm">
	<input type="checkbox" bind:checked={question.required} class="size-4" />
	必須
</label>

{#if hasOptions(question.type)}
	<OptionList bind:question {index} {history} />
{/if}
