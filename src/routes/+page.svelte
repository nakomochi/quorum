<script lang="ts">
	let { data } = $props();

	const avatarUrl = $derived(data.user?.image ?? null);
</script>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
	<header>
		<h1 class="text-2xl font-semibold tracking-tight">form-discord</h1>
		<p class="mt-1 text-sm text-slate-400">Discord 認証つきフォーム / 出欠管理</p>
	</header>

	{#if data.user}
		<section class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
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

			<form method="POST" action="?/logout">
				<button
					type="submit"
					class="mt-5 w-full rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium
						transition hover:bg-slate-800"
				>
					ログアウト
				</button>
			</form>
		</section>
	{:else}
		<form method="POST" action="?/login">
			<button
				type="submit"
				class="bg-discord hover:bg-discord-hover w-full rounded-lg px-4 py-3 text-sm font-semibold
					text-white transition"
			>
				Discord でログイン
			</button>
		</form>
	{/if}
</main>
