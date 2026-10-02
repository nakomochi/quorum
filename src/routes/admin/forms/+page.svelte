<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Pager from '$lib/components/Pager.svelte';
	import { displayJst } from '$lib/display-date';

	let { data } = $props();

	let syncing = $state(false);
</script>

<main class="page-wide">
	<header class="flex items-center justify-between gap-4">
		<div>
			<h1 class="page-title">フォーム管理</h1>
			<p class="mt-1 text-sm text-text-muted">全{data.total}件</p>
		</div>
		<a href={resolve('/forms/new')} class="btn-primary px-4 py-2">新規作成</a>
	</header>

	<!-- The button stays at the right end at every width; the line wraps beside it instead. -->
	<section class="card flex items-center gap-4 px-5 py-3">
		<p class="min-w-0 flex-1 text-sm text-text-subtle">
			メンバー情報
			{#if data.syncedAt}
				<span class="whitespace-nowrap">{displayJst(data.syncedAt)} に更新</span>
			{:else}
				まだ同期していません
			{/if}
		</p>
		<form
			method="POST"
			action="?/sync"
			class="shrink-0"
			use:enhance={() => {
				syncing = true;
				return async ({ update }) => {
					await update();
					syncing = false;
				};
			}}
		>
			<button type="submit" class="btn-secondary px-4 py-2" disabled={syncing}>
				{syncing ? '更新中…' : '更新'}
			</button>
		</form>
	</section>

	{#if data.forms.length === 0}
		<p class="card p-6 text-sm text-text-muted">
			{data.total === 0 ? 'まだフォームがありません。' : 'このページにはフォームがありません。'}
		</p>
	{:else}
		<div class="table-wrap">
			<table class="data-table">
				<thead>
					<tr>
						<th>タイトル</th>
						<th class="whitespace-nowrap">対象ロール</th>
						<th class="whitespace-nowrap">締切</th>
						<th class="whitespace-nowrap">提出/対象</th>
						<th class="whitespace-nowrap">状態</th>
					</tr>
				</thead>
				<tbody>
					{#each data.forms as row (row.id)}
						<tr>
							<td class="max-w-64 font-medium">
								<a href={resolve('/forms/[id]/results', { id: row.id })} class="hover:underline"
									>{row.title}</a
								>
							</td>
							<td class="whitespace-nowrap text-text-subtle">
								{#if row.roleName === null}
									<span class="text-text-muted">なし（サーバーの全員）</span>
								{:else}
									{row.roleName}
									{#if row.submitScope === 'everyone'}
										<span class="ml-1 text-xs text-text-muted">(提出は全員可)</span>
									{/if}
								{/if}
							</td>
							<td class="whitespace-nowrap text-text-subtle tabular-nums">
								{displayJst(row.deadline)}
							</td>
							<td class="whitespace-nowrap text-text-subtle tabular-nums">
								<!-- No denominator without a role: there is no roster to count against. -->
								{row.targetCount === null ? row.submitted : `${row.submitted}/${row.targetCount}`}
								{#if row.outsiders > 0}
									<span
										class="block text-xs text-text-muted"
										title="対象外からの回答 {row.outsiders}名"
									>
										対象外 +{row.outsiders}
									</span>
								{/if}
							</td>
							<td class="whitespace-nowrap">
								{#if row.closed}
									<span class="badge badge-muted">受付終了</span>
								{:else}
									<span class="badge badge-success">受付中</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<Pager newer={data.newer} older={data.older} />
</main>
