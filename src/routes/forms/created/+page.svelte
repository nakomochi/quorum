<script lang="ts">
	import { resolve } from '$app/paths';
	import ContextLink from '$lib/components/ContextLink.svelte';
	import CreatedFormItem from '$lib/components/CreatedFormItem.svelte';
	import Pager from '$lib/components/Pager.svelte';

	let { data } = $props();
</script>

<main class="page">
	<div class="flex flex-col gap-3">
		<ContextLink href={resolve('/')} label="トップへ戻る" direction="back" />
		<header>
			<h1 class="page-title">作成したフォーム</h1>
			<p class="mt-1 text-sm text-text-muted">全{data.total}件</p>
		</header>
	</div>

	{#if data.rows.length === 0}
		<p class="card p-6 text-sm text-text-muted">
			{data.total === 0
				? 'まだ作成したフォームはありません。'
				: 'このページにはフォームがありません。'}
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
