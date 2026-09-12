<script lang="ts">
	import { formatJst } from '$lib/datetime';
	import Icon from '$lib/icons/Icon.svelte';

	let { data } = $props();

	const avatarUrl = $derived(data.user?.image ?? null);

	const format = (value: Date | null) => formatJst(value, '締切なし');

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
</script>

<main
	class="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10 {data.user
		? ''
		: 'justify-center'}"
>
	{#if data.user}
		<header class="flex items-center justify-between gap-3">
			<h1 class="shrink-0 text-lg font-semibold">form-discord</h1>
			<div class="flex min-w-0 items-center gap-2">
				{#if avatarUrl}
					<img
						src={avatarUrl}
						alt=""
						class="border-border-strong size-8 shrink-0 rounded-full border"
					/>
				{:else}
					<div class="border-border-strong bg-surface-raised size-8 shrink-0 rounded-full border"></div>
				{/if}
				<span class="truncate text-sm">{data.user.name}</span>
				<form method="POST" action="?/logout" class="shrink-0">
					<button
						type="submit"
						class="border-border-strong hover:bg-surface-raised rounded-lg border px-3 py-1.5
							text-xs font-medium transition"
					>
						ログアウト
					</button>
				</form>
			</div>
		</header>

		{#if data.member || data.isAdmin}
			<div class="flex flex-wrap gap-3">
				{#if data.member}
					<a href="/forms/new" class="btn-primary inline-flex items-center gap-1.5 px-4 py-2">
						<Icon name="plus" />
						フォームを作る
					</a>
				{/if}
				{#if data.isAdmin}
					<a
						href="/admin/forms"
						class="border-border-strong hover:bg-surface-raised rounded-lg border px-4 py-2 text-sm font-medium transition"
					>
						フォーム管理
					</a>
				{/if}
			</div>
		{/if}

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
										<span>{format(row.deadline)}</span>
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if data.submitted.length > 0}
				<section>
					<h2 class="text-text-subtle text-sm font-medium">提出済みのフォーム</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.submitted as row (row.id)}
							<li class="card">
								<a href="/forms/{row.id}" class="flex items-center justify-between gap-4 px-5 py-4">
									<span class="text-text-subtle flex min-w-0 items-center gap-2">
										<Icon name="check" class="text-success size-4 shrink-0" />
										{row.title}
									</span>
									<span class="text-text-muted shrink-0 text-xs">{format(row.deadline)}</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if data.created.length > 0}
				<section>
					<h2 class="text-text-subtle text-sm font-medium">自分が作成したフォーム</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.created as row (row.id)}
							<li class="card">
								<a
									href="/forms/{row.id}/results"
									class="flex items-center justify-between gap-4 px-5 py-4"
								>
									<span class="font-medium">{row.title}</span>
									<span class="text-text-muted flex shrink-0 items-center gap-3 text-xs">
										<span>{format(row.deadline)}</span>
										<span class="tabular-nums">{row.responseCount} 件の回答</span>
									</span>
								</a>
							</li>
						{/each}
					</ul>
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
