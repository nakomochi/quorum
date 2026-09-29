<script lang="ts">
	import { enhance } from '$app/forms';
	import { displayJst } from '$lib/display-date';

	let { data, form } = $props();

	let syncing = $state(false);
</script>

<main class="page-wide">
	<header class="flex items-center justify-between gap-4">
		<div>
			<h1 class="page-title">フォーム管理</h1>
			<p class="mt-1 text-sm text-text-muted">{data.forms.length}件</p>
		</div>
		<a href="/forms/new" class="btn-primary px-4 py-2">新規作成</a>
	</header>

	<section class="card action-row px-5 py-4">
		<div class="min-w-0 flex-1 text-sm">
			<p class="text-text-subtle">
				メンバー情報
				{#if data.syncedAt}
					<span class="whitespace-nowrap">{displayJst(data.syncedAt)}</span> に更新
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
			まだフォームがありません。
		</p>
	{:else}
		<div class="table-wrap">
			<table class="data-table">
				<thead>
					<tr>
						<th>タイトル</th>
						<th class="whitespace-nowrap">対象ロール</th>
						<th class="whitespace-nowrap">締切</th>
						<th class="whitespace-nowrap">提出 / 対象</th>
						<th class="whitespace-nowrap">状態</th>
					</tr>
				</thead>
				<tbody>
					{#each data.forms as row (row.id)}
						<tr>
							<td class="max-w-64 font-medium">
								<a href="/forms/{row.id}/results" class="hover:underline">{row.title}</a>
							</td>
							<td class="whitespace-nowrap text-text-subtle">
								{row.roleName}
								{#if row.submitScope === 'everyone'}
									<span class="ml-1 text-xs text-text-muted">(提出は全員可)</span>
								{/if}
							</td>
							<td class="whitespace-nowrap text-text-subtle tabular-nums">
								{displayJst(row.deadline)}
							</td>
							<td class="tabular-nums whitespace-nowrap text-text-subtle">
								{row.submitted} / {row.targetCount}
								{#if row.outsiders > 0}
									<span class="block text-xs text-text-muted" title="対象外からの回答 {row.outsiders}名">
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
</main>
