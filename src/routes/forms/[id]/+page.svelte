<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatJst } from '$lib/datetime';
	import { MAX_TEXT_ANSWER, type AnswerValue } from '$lib/forms';
	import Icon from '$lib/icons/Icon.svelte';

	let { data, form } = $props();

	const answers = $derived(data.answers as Record<number, AnswerValue | undefined>);

	const isChecked = (questionId: number, optionId: string) => {
		const value = answers[questionId];
		if (value?.type === 'single') return value.optionId === optionId;
		if (value?.type === 'multi') return value.optionIds.includes(optionId);
		return false;
	};

	const textValue = (questionId: number) => {
		const value = answers[questionId];
		if (value?.type === 'text') return value.text;
		if (value?.type === 'date') return value.date;
		return '';
	};

	function readable(questionId: number, options: { id: string; label: string }[] | null): string {
		const value = answers[questionId];
		if (!value) return '（未回答）';
		const labelOf = (id: string) => options?.find((option) => option.id === id)?.label ?? id;
		switch (value.type) {
			case 'single':
				return labelOf(value.optionId);
			case 'multi':
				return value.optionIds.map(labelOf).join('、');
			case 'text':
				return value.text;
			case 'date':
				return value.date;
		}
	}

</script>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
	<header>
		<h1 class="text-xl font-semibold tracking-tight">{data.form.title}</h1>
		{#if data.form.description}
			<p class="mt-2 text-sm whitespace-pre-wrap text-text-subtle">{data.form.description}</p>
		{/if}
		<p class="mt-2 text-xs text-text-muted">
			締切: {formatJst(data.form.deadline)} / 受付終了: {formatJst(data.form.closesAt)}
		</p>
	</header>

	{#if form?.message}
		<p role="alert" class="alert-error">
			{form.message}
		</p>
	{:else if form?.saved}
		<p role="status" class="alert-success">回答を保存しました。</p>
	{/if}

	{#if data.submittedAt}
		<p class="text-sm text-text-muted">提出済み（{formatJst(data.submittedAt)}）</p>
	{/if}

	{#if data.closed}
		<p class="border-border bg-surface rounded-lg border px-4 py-3 text-sm text-text-subtle">
			このフォームは受付を終了しています。
		</p>
	{/if}

	{#if data.editable}
		<form method="POST" use:enhance class="flex flex-col gap-5">
			{#each data.questions as q (q.id)}
				<!-- The card is the wrapper, not the fieldset: a bordered fieldset lets the browser cut a
				     notch for the legend and start its padding below it, which misaligns the heading. -->
				<div class="card p-5">
					<fieldset class="m-0 border-0 p-0">
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

			<button type="submit" class="btn-primary self-start px-5 py-2.5">
				{data.submittedAt ? '回答を更新' : '提出する'}
			</button>
		</form>
	{:else}
		<div class="flex flex-col gap-4">
			{#each data.questions as q (q.id)}
				<div class="card p-5">
					<p class="text-sm font-medium">{q.label}</p>
					<p class="mt-2 text-sm text-text-subtle">{readable(q.id, q.options)}</p>
				</div>
			{/each}
		</div>
	{/if}

	<div class="flex gap-4 text-sm text-text-muted">
		{#if data.resultsVisible}
			<a href="/forms/{data.form.id}/results" class="hover:underline">回答状況を見る</a>
		{/if}
		<a href="/" class="inline-flex items-center gap-1.5 hover:underline">
			<Icon name="arrow-left" />
			トップへ
		</a>
	</div>
</main>
