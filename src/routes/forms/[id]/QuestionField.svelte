<script lang="ts">
	import {
		MAX_OTHER_ANSWER,
		MAX_TEXT_ANSWER,
		OTHER_OPTION_ID,
		type AnswerValue
	} from '$lib/forms';
	import type { PageData } from './$types';

	type Props = {
		question: PageData['questions'][number];
		/** What the fields start from. They take it only when they are created. */
		value: AnswerValue | undefined;
	};

	let { question, value }: Props = $props();

	const isChecked = (optionId: string) => {
		if (value?.type === 'single') return 'optionId' in value && value.optionId === optionId;
		if (value?.type === 'multi') return value.optionIds.includes(optionId);
		return false;
	};

	const otherValue = (): string | undefined => {
		if (value?.type === 'single') return 'other' in value ? value.other : undefined;
		if (value?.type === 'multi') return value.other;
		return undefined;
	};

	const textValue = () => {
		if (value?.type === 'text') return value.text;
		if (value?.type === 'date') return value.date;
		return '';
	};

	const otherChoiceId = $derived(`q_${question.id}_other_choice`);

	function otherChoice(): HTMLInputElement | null {
		const choice = document.getElementById(otherChoiceId);
		return choice instanceof HTMLInputElement ? choice : null;
	}

	// Typing an "その他" answer chooses it, as in Google Forms.
	function chooseOther(text: string) {
		const choice = otherChoice();
		if (text.trim() === '' || !choice || choice.checked) return;
		choice.checked = true;
		// A scripted check fires no event, and checkQuestion listens for one.
		choice.dispatchEvent(new Event('change', { bubbles: true }));
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

<!-- The card is the wrapper, not the fieldset: a bordered fieldset lets the browser cut a
     notch for the legend and start its padding below it, which misaligns the heading. -->
<div class="card p-5">
	<fieldset class="m-0 border-0 p-0" use:recheck={checkQuestion}>
		<legend class="mb-3 block text-sm font-medium">
			{question.label}
			{#if question.required}<span class="text-danger">*</span>{/if}
		</legend>
		{#if question.helpText}
			<p class="-mt-2 mb-3 text-xs text-text-muted">{question.helpText}</p>
		{/if}

		{#if question.type === 'single' || question.type === 'multi'}
			<div class="flex flex-col gap-2">
				{#each question.options ?? [] as option (option.id)}
					<label class="flex items-center gap-2 text-sm">
						<input
							type={question.type === 'single' ? 'radio' : 'checkbox'}
							name="q_{question.id}"
							value={option.id}
							checked={isChecked(option.id)}
							required={question.required && question.type === 'single'}
							class="accent-accent size-4"
						/>
						{option.label}
					</label>
				{/each}
				{#if question.allowOther}
					<div class="flex items-center gap-2 text-sm">
						<label class="flex shrink-0 items-center gap-2">
							<input
								type={question.type === 'single' ? 'radio' : 'checkbox'}
								id={otherChoiceId}
								name="q_{question.id}"
								value={OTHER_OPTION_ID}
								checked={otherValue() !== undefined}
								required={question.required && question.type === 'single'}
								class="accent-accent size-4"
							/>
							その他:
						</label>
						<input
							type="text"
							name="q_{question.id}_other"
							value={otherValue() ?? ''}
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
				required={question.required}
				maxlength={MAX_TEXT_ANSWER}
				class="field">{textValue()}</textarea
			>
		{:else}
			<input
				type="date"
				name="q_{question.id}"
				value={textValue()}
				aria-label={question.label}
				required={question.required}
				class="field"
			/>
		{/if}
	</fieldset>
</div>
