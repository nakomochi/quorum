<script lang="ts">
	import { formatJst } from '$lib/datetime';
	import { describeAnswer, sameAnswer } from '$lib/forms';
	import Icon from '$lib/icons/Icon.svelte';

	let { data } = $props();

	type Question = (typeof data.questions)[number];

	function readable(index: number, q: Question): string {
		const value = data.revisions[index].answers[q.id];
		return value ? describeAnswer(value, q.options) : '（未回答）';
	}

	// Newest first, so the revision before this one is the next entry.
	function changed(index: number, q: Question): boolean {
		const previous = data.revisions[index + 1];
		return (
			previous !== undefined &&
			!sameAnswer(data.revisions[index].answers[q.id], previous.answers[q.id])
		);
	}
</script>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
	<a
		href="/forms/{data.form.id}/results"
		class="inline-flex items-center gap-1.5 self-start text-sm text-text-muted hover:underline"
	>
		<Icon name="arrow-left" />
		回答状況へ戻る
	</a>

	<header>
		<h1 class="text-xl font-semibold tracking-tight">{data.response.displayName} さんの回答履歴</h1>
		<p class="mt-1 text-sm text-text-muted">{data.form.title}</p>
		<p class="mt-2 text-xs text-text-muted">
			提出日時: {formatJst(data.response.submittedAt)}
			/ 最終更新: {formatJst(data.response.updatedAt)}
		</p>
	</header>

	<ol class="flex flex-col gap-4">
		{#each data.revisions as revision, index (revision.number)}
			<li class="card p-5">
				<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
					<h2 class="text-sm font-semibold">{revision.number}版目</h2>
					{#if index === 0}
						<span class="bg-success-badge text-success rounded px-2 py-0.5 text-xs">最新</span>
					{/if}
					{#if revision.number === 1}
						<span class="bg-surface-raised rounded px-2 py-0.5 text-xs text-text-muted">初回提出</span>
					{/if}
					<span class="text-xs text-text-muted tabular-nums">{formatJst(revision.createdAt)}</span>
				</div>
				<dl class="mt-4 flex flex-col gap-4">
					{#each data.questions as q (q.id)}
						<div>
							<dt class="flex flex-wrap items-center gap-2 text-sm font-medium">
								{q.label}
								{#if changed(index, q)}
									<span class="bg-warning-surface text-warning rounded px-1.5 py-0.5 text-xs font-normal">
										変更
									</span>
								{/if}
							</dt>
							<dd class="mt-1 text-sm whitespace-pre-wrap text-text-subtle">{readable(index, q)}</dd>
						</div>
					{/each}
				</dl>
			</li>
		{/each}
	</ol>
</main>
