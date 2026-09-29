<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatJst } from '$lib/datetime';
	import Icon from '$lib/icons/Icon.svelte';

	let { data, form } = $props();

	const deadlineText = (value: Date | null) => (value ? `締切 ${formatJst(value)}` : '締切なし');

	const SOON_MS = 48 * 60 * 60 * 1000;

	/**
	 * Read once per render, not per row. Two coarse buckets keep SSR and hydration in agreement;
	 * a relative "あと3時間" string would not, and would warn on every load.
	 *
	 * Deliberately `deadline`, not `closesAt`: a form past its deadline but still open is exactly
	 * the one to flag red, because it can — and should — still be answered right now.
	 */
	const now = Date.now();

	const urgency = (deadline: Date | null): 'overdue' | 'soon' | null => {
		if (!deadline) return null;
		const remaining = deadline.getTime() - now;
		if (remaining < 0) return 'overdue';
		return remaining <= SOON_MS ? 'soon' : null;
	};

	// These two only ever grow; show a window of them until asked for the rest.
	const PREVIEW = 3;

	let allSubmitted = $state(false);
	let allCreated = $state(false);

	const submitted = $derived(allSubmitted ? data.submitted : data.submitted.slice(0, PREVIEW));
	const created = $derived(allCreated ? data.created : data.created.slice(0, PREVIEW));
</script>

<!-- Signed in, the shared header sits above; signed out there is none, and the login is centred. -->
<main
	class="mx-auto flex max-w-2xl flex-col gap-6 px-6 {data.user
		? 'pt-8 pb-10'
		: 'min-h-screen justify-center py-10'}"
>
	{#if data.user}
		{#if !data.member}
			<p class="card text-text-muted p-5 text-sm">
				対象の Discord サーバーのメンバーではないため、フォームは表示されません。
			</p>
		{:else}
			<section>
				<h2 class="text-text text-base font-semibold">
					未提出{data.pending.length > 0 ? ` ${data.pending.length} 件` : ''}
				</h2>
				{#if data.pending.length === 0}
					<div class="card mt-3 flex flex-col items-center gap-2 p-6 text-center">
						<Icon name="check" class="text-success size-6" />
						<p class="text-text-subtle text-sm">すべて提出済みです</p>
					</div>
				{:else}
					<ul class="mt-3 flex flex-col gap-2">
						{#each data.pending as row (row.id)}
							{@const level = urgency(row.deadline)}
							<li
								class="card border-l-2 {level === 'overdue' ? 'border-l-danger' : 'border-l-accent'}"
							>
								<a href="/forms/{row.id}" class="flex flex-col gap-1 px-5 py-4">
									<span class="font-medium">{row.title}</span>
									<span class="text-text-muted flex flex-wrap items-center gap-2 text-xs">
										{#if level === 'overdue'}
											<span class="bg-error-surface text-error-fg rounded px-2 py-0.5">期限切れ</span>
										{:else if level === 'soon'}
											<span class="bg-warning-surface text-warning rounded px-2 py-0.5">締切間近</span>
										{/if}
										<span class="whitespace-nowrap">{deadlineText(row.deadline)}</span>
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if data.submitted.length > 0}
				<section>
					<h2 class="text-text-subtle text-sm font-medium">
						提出済みのフォーム {data.submitted.length} 件
					</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each submitted as row (row.id)}
							<li class="card">
								<a
									href="/forms/{row.id}"
									class="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
								>
									<span class="text-text-subtle flex min-w-0 items-center gap-2">
										<Icon name="check" class="text-success size-4 shrink-0" />
										{row.title}
									</span>
									<!-- The badge goes before the date once the dates are right-aligned, and after it
									     while they stack left-aligned, so the dates line up either way. -->
									<span class="text-text-muted flex shrink-0 items-center gap-2 text-xs">
										<span class="whitespace-nowrap tabular-nums">提出 {formatJst(row.submittedAt)}</span>
										{#if row.revisionCount > 1}
											<span
												class="bg-surface-raised text-text-subtle rounded px-2 py-0.5 whitespace-nowrap
													sm:order-first"
											>
												編集済み
											</span>
										{/if}
									</span>
								</a>
							</li>
						{/each}
					</ul>
					{#if data.submitted.length > PREVIEW}
						<button
							type="button"
							class="text-text-muted hover:text-text-subtle mt-2 text-xs hover:underline"
							onclick={() => (allSubmitted = !allSubmitted)}
						>
							{allSubmitted ? '一部だけ表示' : `すべて表示（${data.submitted.length} 件）`}
						</button>
					{/if}
				</section>
			{/if}

			{#if data.drafts.length > 0}
				<section>
					<h2 class="text-text-subtle text-sm font-medium">下書き {data.drafts.length} 件</h2>
					{#if form?.message}
						<p role="alert" class="alert-error mt-2">{form.message}</p>
					{/if}
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.drafts as row (row.id)}
							<li class="card flex items-center gap-2 pr-3">
								<a
									href="/forms/new?draft={row.id}"
									class="flex min-w-0 flex-1 flex-col gap-1 py-4 pl-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
								>
									<span class="flex min-w-0 items-center gap-2 {row.title ? 'font-medium' : 'text-text-muted'}">
										<Icon name="pencil" class="text-text-muted size-4 shrink-0" />
										{row.title ?? '無題のフォーム'}
									</span>
									<span class="text-text-muted shrink-0 text-xs whitespace-nowrap tabular-nums">
										更新 {formatJst(row.updatedAt)}
									</span>
								</a>
								<form
									method="POST"
									action="?/discardDraft"
									use:enhance={({ cancel }) => {
										if (!confirm('この下書きを削除します')) cancel();
									}}
									class="shrink-0"
								>
									<input type="hidden" name="id" value={row.id} />
									<button
										type="submit"
										class="btn-secondary px-3 py-1.5 text-xs"
										aria-label="「{row.title ?? '無題のフォーム'}」の下書きを破棄"
									>
										破棄
									</button>
								</form>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if data.created.length > 0}
				<section>
					<h2 class="text-text-subtle text-sm font-medium">
						自分が作成したフォーム {data.created.length} 件
					</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each created as row (row.id)}
							<li class="card">
								<a
									href="/forms/{row.id}/results"
									class="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
								>
									<span class="min-w-0 font-medium">{row.title}</span>
									<!-- Inline text rather than flex: a line may break after a ・ but never before
									     one, so a wrap never opens a line with the separator. -->
									<span class="text-text-muted shrink-0 text-xs">
										<span class="whitespace-nowrap">{deadlineText(row.deadline)}</span>
										・
										<span class="whitespace-nowrap tabular-nums">{row.responseCount} 件の回答</span>
									</span>
								</a>
							</li>
						{/each}
					</ul>
					{#if data.created.length > PREVIEW}
						<button
							type="button"
							class="text-text-muted hover:text-text-subtle mt-2 text-xs hover:underline"
							onclick={() => (allCreated = !allCreated)}
						>
							{allCreated ? '一部だけ表示' : `すべて表示（${data.created.length} 件）`}
						</button>
					{/if}
				</section>
			{/if}
		{/if}
	{:else}
		<header>
			<h1 class="text-2xl font-semibold tracking-tight">form-discord</h1>
			<p class="text-text-muted mt-1 text-sm">Discord 認証つきフォーム / 出欠管理</p>
		</header>

		<form method="POST" action="?/login">
			<button type="submit" class="btn-primary w-full px-4 py-3"> Discord でログイン </button>
		</form>
	{/if}
</main>
