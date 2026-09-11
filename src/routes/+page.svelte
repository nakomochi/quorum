<script lang="ts">
	import { formatJst } from '$lib/datetime';

	let { data } = $props();

	const avatarUrl = $derived(data.user?.image ?? null);

	const format = (value: Date | null) => formatJst(value, '締切なし');
</script>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
	<header>
		<h1 class="text-2xl font-semibold tracking-tight">form-discord</h1>
		<p class="mt-1 text-sm text-slate-400">Discord 認証つきフォーム / 出欠管理</p>
	</header>

	{#if data.user}
		<section class="card p-5">
			<div class="flex items-center gap-4">
				{#if avatarUrl}
					<img src={avatarUrl} alt="" class="size-14 rounded-full border border-slate-700" />
				{:else}
					<div class="size-14 rounded-full border border-slate-700 bg-slate-800"></div>
				{/if}
				<div class="min-w-0">
					<p class="truncate font-medium">{data.user.name}</p>
					<p class="truncate font-mono text-xs text-slate-400">{data.user.discordId}</p>
				</div>
			</div>

			<div class="mt-5 flex flex-wrap items-center gap-3">
				{#if data.member}
					<a href="/forms/new" class="btn-primary px-4 py-2">フォームを作る</a>
				{/if}
				{#if data.isAdmin}
					<a
						href="/admin/forms"
						class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium transition hover:bg-slate-800"
					>
						フォーム管理
					</a>
				{/if}
				<form method="POST" action="?/logout" class="flex-1">
					<button
						type="submit"
						class="w-full rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium
							transition hover:bg-slate-800"
					>
						ログアウト
					</button>
				</form>
			</div>
		</section>

		{#if !data.member}
			<p class="card p-5 text-sm text-slate-400">
				対象の Discord サーバーのメンバーではないため、フォームは表示されません。
			</p>
		{:else}
			<section>
				<h2 class="text-sm font-medium text-slate-300">未提出のフォーム</h2>
				{#if data.pending.length === 0}
					<p class="mt-2 text-sm text-slate-400">未提出のフォームはありません。</p>
				{:else}
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.pending as row (row.id)}
							<li class="card">
								<a href="/forms/{row.id}" class="flex items-center justify-between gap-4 px-5 py-4">
									<span class="font-medium">{row.title}</span>
									<span class="shrink-0 text-xs text-slate-400">{format(row.deadline)}</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section>
				<h2 class="text-sm font-medium text-slate-300">提出済みのフォーム</h2>
				{#if data.submitted.length === 0}
					<p class="mt-2 text-sm text-slate-400">提出済みのフォームはありません。</p>
				{:else}
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.submitted as row (row.id)}
							<li class="card">
								<a href="/forms/{row.id}" class="flex items-center justify-between gap-4 px-5 py-4">
									<span class="text-slate-300">{row.title}</span>
									<span class="shrink-0 text-xs text-slate-400">{format(row.deadline)}</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section>
				<h2 class="text-sm font-medium text-slate-300">自分が作成したフォーム</h2>
				{#if data.created.length === 0}
					<p class="mt-2 text-sm text-slate-400">作成したフォームはありません。</p>
				{:else}
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.created as row (row.id)}
							<li class="card">
								<a
									href="/forms/{row.id}/results"
									class="flex items-center justify-between gap-4 px-5 py-4"
								>
									<span class="font-medium">{row.title}</span>
									<span class="flex shrink-0 items-center gap-3 text-xs text-slate-400">
										<span>{format(row.deadline)}</span>
										<span class="tabular-nums">{row.responseCount} 件の回答</span>
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{:else}
		<form method="POST" action="?/login">
			<button type="submit" class="btn-primary w-full px-4 py-3">
				Discord でログイン
			</button>
		</form>
	{/if}
</main>
