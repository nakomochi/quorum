<script lang="ts">
	import ContextLink from '$lib/components/ContextLink.svelte';
	import CreatedFormItem from '$lib/components/CreatedFormItem.svelte';
	import Pager from '$lib/components/Pager.svelte';

	let { data } = $props();
</script>

<main class="page">
	<div class="flex flex-col gap-3">
		<ContextLink href="/" label="トップへ戻る" direction="back" />
		<header>
			<h1 class="page-title">作成したフォーム</h1>
			<p class="text-text-muted mt-1 text-sm">全{data.total}件</p>
		</header>
	</div>

	{#if data.rows.length === 0}
		<p class="card text-text-muted p-6 text-sm">
			{data.total === 0 ? 'まだ作成したフォームはありません。' : 'このページにはフォームがありません。'}
		</p>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each data.rows as row (row.id)}
				<CreatedFormItem {row} />
			{/each}
		</ul>
	{/if}

	<Pager newer={data.newer} older={data.older} />
</main>
