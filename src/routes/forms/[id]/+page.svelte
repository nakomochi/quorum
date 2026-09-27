<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatJst } from '$lib/datetime';
	import {
		describeAnswer,
		MAX_OTHER_ANSWER,
		MAX_TEXT_ANSWER,
		OTHER_OPTION_ID,
		type AnswerValue
	} from '$lib/forms';
	import Icon from '$lib/icons/Icon.svelte';

	let { data, form } = $props();

	const answers = $derived(data.answers as Record<number, AnswerValue | undefined>);

	// Both follow the latest action result, and 回答を編集 overrides them until the next one
	// arrives: a failure keeps the form open, a success returns to the confirmation.
	let editing = $derived(form?.message !== undefined);
	let saved = $derived(form?.created);
	let submitting = $state(false);

	const submitted = $derived(data.submittedAt !== null);
	// Held open while a save is in flight: its reload lands before its result, and the
	// confirmation would otherwise flash up with the heading meant for a later visit.
	const showForm = $derived(data.editable && (!submitted || editing || submitting));

	const heading = $derived(
		saved === true ? '回答を送信しました' : saved === false ? '回答を更新しました' : '回答済みです'
	);

	// Minute precision: an edit within the same minute as the submission adds nothing to show.
	const updatedAt = $derived(
		data.updatedAt && formatJst(data.updatedAt) !== formatJst(data.submittedAt)
			? formatJst(data.updatedAt)
			: null
	);

	const isChecked = (questionId: number, optionId: string) => {
		const value = answers[questionId];
		if (value?.type === 'single') return 'optionId' in value && value.optionId === optionId;
		if (value?.type === 'multi') return value.optionIds.includes(optionId);
		return false;
	};

	const otherValue = (questionId: number): string | undefined => {
		const value = answers[questionId];
		if (value?.type === 'single') return 'other' in value ? value.other : undefined;
		if (value?.type === 'multi') return value.other;
		return undefined;
	};

	const textValue = (questionId: number) => {
		const value = answers[questionId];
		if (value?.type === 'text') return value.text;
		if (value?.type === 'date') return value.date;
		return '';
	};

	function readable(questionId: number, options: { id: string; label: string }[] | null): string {
		const value = answers[questionId];
		return value ? describeAnswer(value, options) : '（未回答）';
	}

	type Question = (typeof data.questions)[number];

	const otherChoiceId = (questionId: number) => `q_${questionId}_other_choice`;

	function otherChoice(questionId: number): HTMLInputElement | null {
		const choice = document.getElementById(otherChoiceId(questionId));
		return choice instanceof HTMLInputElement ? choice : null;
	}

	// Typing an "その他" answer chooses it, as in Google Forms.
	function chooseOther(questionId: number, text: string) {
		const choice = otherChoice(questionId);
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
	function checkQuestion(fieldset: HTMLFieldSetElement, q: Question) {
		if (q.type === 'multi' && q.required) {
			const boxes = fieldset.querySelectorAll<HTMLInputElement>(`input[name="q_${q.id}"]`);
			const picked = [...boxes].some((box) => box.checked);
			boxes[0]?.setCustomValidity(picked ? '' : 'いずれかを選択してください');
		}

		const other = fieldset.querySelector<HTMLInputElement>(`input[name="q_${q.id}_other"]`);
		if (other) {
			other.required = otherChoice(q.id)?.checked ?? false;
			requireFilled(other, other.required);
		}

		const text = fieldset.querySelector<HTMLTextAreaElement>(`textarea[name="q_${q.id}"]`);
		if (text) requireFilled(text, q.required);
	}

	function startEditing() {
		editing = true;
		saved = undefined;
	}

	const submit: SubmitFunction = () => {
		submitting = true;
		return async ({ result, update }) => {
			// The fields take their values from props, so a reset would blank them with no change in
			// data to draw them again.
			await update({ reset: false });
			submitting = false;
			// The outcome is shown at the top, and the submit button sits at the bottom of the form.
			if (result.type === 'success' || result.type === 'failure') window.scrollTo({ top: 0 });
		};
	};
</script>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
	<div class="flex flex-col gap-3">
		<nav class="flex items-center justify-between gap-4 text-sm text-text-muted">
			<a href="/" class="inline-flex items-center gap-1.5 hover:underline">
				<Icon name="arrow-left" />
				トップ
			</a>
			{#if data.resultsVisible}
				<a
					href="/forms/{data.form.id}/results"
					class="inline-flex items-center gap-1.5 hover:underline"
				>
					回答状況を見る
					<Icon name="arrow-right" />
				</a>
			{/if}
		</nav>

		<!-- The accent bar is a clipped child, not a `border-t-4`: the rounded top corners would
		     otherwise render the border as a thickening wedge. -->
		<header class="card overflow-hidden">
			<div class="bg-accent h-1.5"></div>
			<div class="p-6">
				<h1 class="text-2xl font-semibold tracking-tight">{data.form.title}</h1>
				{#if data.form.description}
					<p class="mt-2 text-sm whitespace-pre-wrap text-text-subtle">{data.form.description}</p>
				{/if}
				<div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-text-muted">
					{#if data.closed}
						<span class="bg-surface-alt rounded px-2 py-1 text-text-subtle">受付終了</span>
					{/if}
					{#if submitted}
						<span class="bg-success-badge text-success rounded px-2 py-1">提出済み</span>
					{/if}
					<span>
						締切: {formatJst(data.form.deadline)} / 受付終了: {formatJst(data.form.closesAt)}
					</span>
				</div>
			</div>
		</header>
	</div>

	{#if form?.message}
		<p role="alert" class="alert-error">
			{form.message}
		</p>
	{/if}

	{#if showForm}
		<form method="POST" use:enhance={submit} class="flex flex-col gap-5">
			{#each data.questions as q (q.id)}
				<!-- The card is the wrapper, not the fieldset: a bordered fieldset lets the browser cut a
				     notch for the legend and start its padding below it, which misaligns the heading. -->
				<div class="card p-5">
					<fieldset
						class="m-0 border-0 p-0"
						use:recheck={(fieldset) => checkQuestion(fieldset, q)}
					>
						<legend class="mb-3 block text-sm font-medium">
							{q.label}
							{#if q.required}<span class="text-danger">*</span>{/if}
						</legend>
						{#if q.helpText}
							<p class="-mt-2 mb-3 text-xs text-text-muted">{q.helpText}</p>
						{/if}

						{#if q.type === 'single' || q.type === 'multi'}
							<div class="flex flex-col gap-2">
								{#each q.options ?? [] as option (option.id)}
									<label class="flex items-center gap-2 text-sm">
										<input
											type={q.type === 'single' ? 'radio' : 'checkbox'}
											name="q_{q.id}"
											value={option.id}
											checked={isChecked(q.id, option.id)}
											required={q.required && q.type === 'single'}
											class="accent-accent size-4"
										/>
										{option.label}
									</label>
								{/each}
								{#if q.allowOther}
									<div class="flex items-center gap-2 text-sm">
										<label class="flex shrink-0 items-center gap-2">
											<input
												type={q.type === 'single' ? 'radio' : 'checkbox'}
												id={otherChoiceId(q.id)}
												name="q_{q.id}"
												value={OTHER_OPTION_ID}
												checked={otherValue(q.id) !== undefined}
												required={q.required && q.type === 'single'}
												class="accent-accent size-4"
											/>
											その他:
										</label>
										<input
											type="text"
											name="q_{q.id}_other"
											value={otherValue(q.id) ?? ''}
											aria-label="「{q.label}」のその他の内容"
											maxlength={MAX_OTHER_ANSWER}
											oninput={(event) => chooseOther(q.id, event.currentTarget.value)}
											class="field min-w-0 flex-1 py-1"
										/>
									</div>
								{/if}
							</div>
						{:else if q.type === 'text'}
							<textarea
								name="q_{q.id}"
								rows="3"
								aria-label={q.label}
								required={q.required}
								maxlength={MAX_TEXT_ANSWER}
								class="field">{textValue(q.id)}</textarea
							>
						{:else}
							<input
								type="date"
								name="q_{q.id}"
								value={textValue(q.id)}
								aria-label={q.label}
								required={q.required}
								class="field"
							/>
						{/if}
					</fieldset>
				</div>
			{/each}

			<div class="flex items-center gap-4">
				<button type="submit" class="btn-primary px-5 py-2.5" disabled={submitting}>
					{submitted ? '回答を更新' : '送信'}
				</button>
				{#if submitted}
					<button
						type="button"
						class="text-sm text-text-muted hover:underline"
						onclick={() => (editing = false)}
					>
						キャンセル
					</button>
				{/if}
			</div>
		</form>
	{:else if submitted}
		<section class="card flex flex-col gap-4 p-6">
			<div class="flex items-start gap-3">
				<span class="bg-success-badge text-success shrink-0 rounded-full p-1.5">
					<Icon name="check" />
				</span>
				<div>
					<h2 class="text-lg font-semibold">{heading}</h2>
					<p class="mt-1 text-xs text-text-muted">
						提出日時: {formatJst(data.submittedAt)}
						{#if updatedAt}
							/ 最終更新: {updatedAt}
						{/if}
					</p>
					{#if data.closed}
						<p class="mt-2 text-sm text-text-subtle">受付は終了しています。</p>
					{:else if !data.editable}
						<p class="mt-2 text-sm text-text-subtle">
							このフォームは回答の編集が許可されていません。
						</p>
					{/if}
				</div>
			</div>
			{#if data.editable}
				<button
					type="button"
					class="btn-secondary inline-flex items-center gap-1.5 self-start px-4 py-2"
					onclick={startEditing}
				>
					<Icon name="pencil" />
					回答を編集
				</button>
			{/if}
		</section>

		<section class="flex flex-col gap-3">
			<h2 class="text-sm font-medium text-text-subtle">あなたの回答</h2>
			{#each data.questions as q (q.id)}
				<div class="card p-5">
					<p class="text-sm font-medium">{q.label}</p>
					<p class="mt-2 text-sm whitespace-pre-wrap text-text-subtle">{readable(q.id, q.options)}</p>
				</div>
			{/each}
		</section>
	{:else}
		<section class="card p-6">
			<h2 class="text-lg font-semibold">受付を終了しました</h2>
			<p class="mt-1 text-sm text-text-muted">このフォームは回答を受け付けていません。</p>
		</section>
	{/if}
</main>
