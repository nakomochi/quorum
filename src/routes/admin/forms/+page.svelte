<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatJst } from '$lib/datetime';
	import Icon from '$lib/icons/Icon.svelte';

	let { data, form } = $props();

	let syncing = $state(false);
</script>

<main class="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
	<header class="flex items-center justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight">フォーム管理</h1>
			<p class="mt-1 text-sm text-text-muted">{data.forms.length} 件</p>
		</div>
		<a href="/forms/new" class="btn-primary px-4 py-2">新規作成</a>
	</header>

	<section class="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
		<div class="text-sm">
			<p class="text-text-subtle">
				メンバー情報:
				{#if data.syncedAt}
					{formatJst(data.syncedAt)} に更新
				{:else}
					まだ同期していません
				{/if}
			</p>
			{#if form}
				{#if 'message' in form}
					<p role="alert" class="text-danger mt-1">{form.message}</p>
				{:else}
					<p role="status" class="text-success mt-1">
						{form.present}名を同期しました（退会 {form.markedLeft}名）
					</p>
				{/if}
			{/if}
		</div>
		<form
			method="POST"
			action="?/sync"
			use:enhance={() => {
				syncing = true;
				return async ({ update }) => {
					await update();
					syncing = false;
				};
			}}
		>
			<button type="submit" class="chip px-3 py-1.5 text-sm" disabled={syncing}>
				{syncing ? '更新中…' : '更新'}
			</button>
		</form>
	</section>

	{#if data.forms.length === 0}
		<p class="card p-6 text-sm text-text-muted">
			まだフォームがありません。
		</p>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-border">
			<table class="w-max min-w-full text-left text-sm">
				<thead class="bg-surface-alt text-xs text-text-muted">
					<tr>
						<th class="px-4 py-3 font-medium">タイトル</th>
						<th class="px-4 py-3 font-medium whitespace-nowrap">対象ロール</th>
						<th class="px-4 py-3 font-medium whitespace-nowrap">締切</th>
						<th class="px-4 py-3 font-medium whitespace-nowrap">回答数</th>
						<th class="px-4 py-3 font-medium whitespace-nowrap">状態</th>
					</tr>
				</thead>
				<tbody>
					{#each data.forms as row (row.id)}
						<tr class="border-t border-border">
							<td class="max-w-64 px-4 py-3 font-medium">
								<a href="/forms/{row.id}/results" class="hover:underline">{row.title}</a>
							</td>
							<td class="px-4 py-3 whitespace-nowrap text-text-subtle">
								{row.roleName}
								{#if row.submitScope === 'everyone'}
									<span class="ml-1 text-xs text-text-muted">(提出は全員可)</span>
								{/if}
							</td>
							<td class="px-4 py-3 whitespace-nowrap text-text-subtle">{formatJst(row.deadline)}</td>
							<td class="px-4 py-3 tabular-nums whitespace-nowrap text-text-subtle">
								{row.responseCount}
							</td>
							<td class="px-4 py-3 whitespace-nowrap">
								{#if row.closed}
									<span class="bg-surface-raised rounded px-2 py-1 text-xs text-text-muted">受付終了</span>
								{:else}
									<span class="bg-success-badge text-success rounded px-2 py-1 text-xs">
										受付中
									</span>
								{/if}
								{#if row.structureLockedAt}
									<span class="ml-1 text-xs text-text-muted">構造ロック済</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<a href="/" class="inline-flex items-center gap-1.5 self-start text-sm text-text-muted hover:underline">
		<Icon name="arrow-left" />
		トップへ
	</a>
</main>
