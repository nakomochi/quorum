<script lang="ts">
	import { dragHandle } from 'svelte-dnd-action';
	import {
		hasOptions,
		MAX_HELP_TEXT,
		MAX_LABEL,
		QUESTION_TYPE_LABELS,
		QUESTION_TYPES,
		TYPE_LOCKED,
		type QuestionType
	} from '$lib/forms';
	import FieldError from '$lib/components/FieldError.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { newOption, type EditorQuestion } from './editor';
	import type { HistoryControls } from './history.svelte';
	import OptionList from './OptionList.svelte';

	type Props = {
		question: EditorQuestion;
		/** The question's place in the list, counted from 0. */
		index: number;
		history: HistoryControls;
		/** Why the server refused this question. */
		error: string | null;
		/** The type stays as published: the form has responses to this question's type. */
		typeLocked: boolean;
	};

	let { question = $bindable(), index, history, error, typeLocked }: Props = $props();

	const errorId = $derived(`question-${question.id}-error`);
	const typeNoteId = $derived(`question-${question.id}-type-note`);

	function onTypeChange(type: QuestionType) {
		history.step(() => {
			question.type = type;
			if (hasOptions(type) && question.options.length === 0) question.options = [newOption()];
			if (!hasOptions(type)) question.allowOther = false;
		});
	}
</script>

<!-- The open card. Its frame is the list's: animate:flip has to sit on the element the each block
     draws. -->
<div
	use:dragHandle
	aria-label="質問 {index + 1} をドラッグして並び替え"
	class="-mx-5 -mt-5 flex touch-none justify-center rounded-t-xl py-2 text-text-muted outline-accent hover:text-text-subtle focus-visible:outline-2 focus-visible:-outline-offset-2"
>
	<Icon name="grip-horizontal" />
</div>

<span class="text-xs text-text-muted">質問 {index + 1}</span>

<!-- The message may concern any part of the question, so it heads the fields rather than one of them. -->
<FieldError id={errorId} message={error} />

<div class="grid gap-3 sm:grid-cols-[1fr_10rem]">
	<input
		bind:value={question.label}
		data-question-label
		aria-label="質問 {index + 1} の質問文"
		aria-invalid={error ? true : undefined}
		aria-describedby={error ? errorId : undefined}
		placeholder="質問文"
		required
		maxlength={MAX_LABEL}
		class="field self-start"
	/>
	<div>
		<SelectField
			value={question.type}
			aria-label="質問 {index + 1} の種類"
			disabled={typeLocked}
			aria-describedby={typeLocked ? typeNoteId : undefined}
			onchange={(event) => onTypeChange(event.currentTarget.value as QuestionType)}
		>
			{#each QUESTION_TYPES as type (type)}
				<option value={type}>{QUESTION_TYPE_LABELS[type]}</option>
			{/each}
		</SelectField>
		{#if typeLocked}
			<span id={typeNoteId} class="mt-1 block text-xs text-text-muted">{TYPE_LOCKED}</span>
		{/if}
	</div>
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
