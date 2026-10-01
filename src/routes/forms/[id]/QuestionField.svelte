<script lang="ts">
	import {
		liveOptions,
		MAX_OTHER_ANSWER,
		MAX_TEXT_ANSWER,
		OTHER_OPTION_ID,
		type AnswerValue
	} from '$lib/forms';
	import { untrack } from 'svelte';
	import FieldError from '$lib/components/FieldError.svelte';
	import type { PageData } from './$types';

	type Props = {
		question: PageData['questions'][number];
		/**
		 * What the fields start from. Read once, when the field is created, into state of its own
		 * that the inputs are bound to: that puts the values in the server's HTML, and a reload of
		 * the data cannot write over what has been typed since. The page redraws the fields to
		 * open them on other answers.
		 */
		value: AnswerValue | undefined;
		/** Why the server refused this answer. */
		error: string | null;
		/** The card's id. */
		id: string;
	};

	let { question, value, error, id }: Props = $props();

	const errorId = $derived(`${id}-error`);

	function initialChoices(): string[] {
		if (value?.type === 'single') return ['optionId' in value ? value.optionId : OTHER_OPTION_ID];
		if (value?.type === 'multi') {
			return value.other === undefined ? value.optionIds : [...value.optionIds, OTHER_OPTION_ID];
		}
		return [];
	}

	function initialOther(): string {
		if (value?.type === 'single') return 'other' in value ? value.other : '';
		if (value?.type === 'multi') return value.other ?? '';
		return '';
	}

	function initialText(): string {
		if (value?.type === 'text') return value.text;
		if (value?.type === 'date') return value.date;
		return '';
	}

	// A radio group binds to one value and a checkbox group to a list; only one of them is drawn.
	let choices = $state(untrack(initialChoices));
	let choice = $state<string | undefined>(untrack(() => initialChoices()[0]));
	let other = $state(untrack(initialOther));
	let text = $state(untrack(initialText));

	const otherChoiceId = $derived(`q_${question.id}_other_choice`);

	function otherChoice(): HTMLInputElement | null {
		const element = document.getElementById(otherChoiceId);
		return element instanceof HTMLInputElement ? element : null;
	}

	// Typing an "その他" answer chooses it, as in Google Forms. Through the element rather than the
	// state: checkQuestion and the page's autosave read the fields within this same event.
	function chooseOther(typed: string) {
		const element = otherChoice();
		if (typed.trim() === '' || !element || element.checked) return;
		element.checked = true;
		// A scripted check fires no event, and both the group binding and checkQuestion listen for one.
		element.dispatchEvent(new Event('change', { bubbles: true }));
	}

	/** Runs `check` on mount, which covers a restored answer, and after every edit inside `node`. */
	function recheck<T extends HTMLElement>(node: T, check: (node: T) => void) {
		const run = () => check(node);
		run();
		node.addEventListener('input', run);
		node.addEventListener('change', run);
		return {
			destroy() {
				node.removeEventListener('input', run);
				node.removeEventListener('change', run);
			}
		};
	}

	// `required` lets whitespace through, and the server trims before checking.
	function requireFilled(field: HTMLInputElement | HTMLTextAreaElement, required: boolean) {
		field.setCustomValidity(required && field.value.trim() === '' ? '入力してください' : '');
	}

	// The browser has no "at least one" for checkboxes, and the "その他" text is only required
	// while its choice is picked. A custom validity puts the browser's bubble beside the control.
	function checkQuestion(fieldset: HTMLFieldSetElement) {
		const q = question;
		if (q.type === 'multi' && q.required) {
			const boxes = fieldset.querySelectorAll<HTMLInputElement>(`input[name="q_${q.id}"]`);
			const picked = [...boxes].some((box) => box.checked);
			boxes[0]?.setCustomValidity(picked ? '' : 'いずれかを選択してください');
		}

		const other = fieldset.querySelector<HTMLInputElement>(`input[name="q_${q.id}_other"]`);
		if (other) {
			other.required = otherChoice()?.checked ?? false;
			requireFilled(other, other.required);
		}

		const text = fieldset.querySelector<HTMLTextAreaElement>(`textarea[name="q_${q.id}"]`);
		if (text) requireFilled(text, q.required);
	}
</script>

<!-- `bind:group` needs a static type, so the radio and the checkbox are written out apiece. -->
{#snippet pick(optionId: string, id?: string)}
	{#if question.type === 'single'}
		<input
			type="radio"
			{id}
			name="q_{question.id}"
			value={optionId}
			bind:group={choice}
			required={question.required}
			class="accent-accent size-4"
		/>
	{:else}
		<input
			type="checkbox"
			{id}
			name="q_{question.id}"
			value={optionId}
			bind:group={choices}
			class="accent-accent size-4"
		/>
	{/if}
{/snippet}

<!-- The card is the wrapper, not the fieldset: a bordered fieldset lets the browser cut a
     notch for the legend and start its padding below it, which misaligns the heading. -->
<div {id} class="card scroll-mt-4 p-5">
	<fieldset
		class="m-0 border-0 p-0"
		aria-describedby={error ? errorId : undefined}
		use:recheck={checkQuestion}
	>
		<legend class="mb-3 block text-sm font-medium">
			{question.label}
			{#if question.required}<span class="text-danger">*</span>{/if}
		</legend>
		{#if question.helpText}
			<p class="-mt-2 mb-3 text-xs text-text-muted">{question.helpText}</p>
		{/if}
		<FieldError id={errorId} message={error} class="-mt-1 mb-3" />

		{#if question.type === 'single' || question.type === 'multi'}
			<div class="flex flex-col gap-2">
				{#each liveOptions(question.options) as option (option.id)}
					<label class="flex items-center gap-2 text-sm">
						{@render pick(option.id)}
						{option.label}
					</label>
				{/each}
				{#if question.allowOther}
					<div class="flex items-center gap-2 text-sm">
						<label class="flex shrink-0 items-center gap-2">
							{@render pick(OTHER_OPTION_ID, otherChoiceId)}
							その他:
						</label>
						<input
							type="text"
							name="q_{question.id}_other"
							bind:value={other}
							aria-label="「{question.label}」のその他の内容"
							maxlength={MAX_OTHER_ANSWER}
							oninput={(event) => chooseOther(event.currentTarget.value)}
							class="field min-w-0 flex-1 py-1"
						/>
					</div>
				{/if}
			</div>
		{:else if question.type === 'text'}
			<textarea
				name="q_{question.id}"
				rows="3"
				aria-label={question.label}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				required={question.required}
				maxlength={MAX_TEXT_ANSWER}
				bind:value={text}
				class="field"
			></textarea>
		{:else}
			<input
				type="date"
				name="q_{question.id}"
				bind:value={text}
				aria-label={question.label}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				required={question.required}
				class="field"
			/>
		{/if}
	</fieldset>
</div>
