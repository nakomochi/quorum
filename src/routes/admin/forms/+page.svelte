<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatJst } from '$lib/datetime';

	let { data, form } = $props();

	let syncing = $state(false);
</script>

<main class="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
	<header class="flex items-center justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight">フォーム管理</h1>
			<p class="mt-1 text-sm text-slate-400">{data.forms.length} 件</p>
		</div>
		<a href="/forms/new" class="btn-primary px-4 py-2">新規作成</a>
	</header>

	<section class="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
		<div class="text-sm">
			<p class="text-slate-300">
				メンバー情報:
				{#if data.syncedAt}
					{formatJst(data.syncedAt)} に更新
				{:else}
					まだ同期していません
				{/if}
			</p>
			{#if form}
				{#if 'message' in form}
					<p class="mt-1 text-red-300">{form.message}</p>
				{:else}
					<p class="mt-1 text-emerald-300">
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
		<p class="card p-6 text-sm text-slate-400">
			まだフォームがありません。
		</p>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-slate-800">
			<table class="w-full text-left text-sm">
				<thead class="bg-slate-900/80 text-xs text-slate-400">
					<tr>
						<th class="px-4 py-3 font-medium">タイトル</th>
						<th class="px-4 py-3 font-medium">対象ロール</th>
						<th class="px-4 py-3 font-medium">締切</th>
						<th class="px-4 py-3 font-medium">回答数</th>
						<th class="px-4 py-3 font-medium">状態</th>
					</tr>
				</thead>
				<tbody>
					{#each data.forms as row (row.id)}
						<tr class="border-t border-slate-800">
							<td class="px-4 py-3 font-medium">{row.title}</td>
							<td class="px-4 py-3 text-slate-300">
								{row.roleName}
								{#if row.submitScope === 'everyone'}
									<span class="ml-1 text-xs text-slate-500">(提出は全員可)</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-slate-300">{formatJst(row.deadline)}</td>
							<td class="px-4 py-3 tabular-nums text-slate-300">{row.responseCount}</td>
							<td class="px-4 py-3">
								{#if row.closed}
									<span class="rounded bg-slate-800 px-2 py-1 text-xs text-slate-400">受付終了</span>
								{:else}
									<span class="rounded bg-emerald-900/60 px-2 py-1 text-xs text-emerald-300">
										受付中
									</span>
								{/if}
								{#if row.structureLockedAt}
									<span class="ml-1 text-xs text-slate-500">構造ロック済</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<a href="/" class="text-sm text-slate-400 hover:underline">← トップへ</a>
</main>
