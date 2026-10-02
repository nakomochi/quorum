<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/icons/Icon.svelte';

	/** The cursors a page of a newest-first list was given; null where nothing lies that way. */
	let { newer, older }: { newer: string | null; older: string | null } = $props();

	const BUTTON = 'btn-secondary inline-flex items-center gap-1.5 px-4 py-2';
</script>

<!-- Both ends keep their place when one of them leads nowhere, so the other does not jump. -->
{#if newer !== null || older !== null}
	<nav aria-label="ページ送り" class="flex items-center justify-between gap-4">
		{#if newer !== null}
			<a href="{page.url.pathname}?after={newer}" class={BUTTON}><Icon name="arrow-left" />新しい方へ</a>
		{:else}
			<span aria-disabled="true" class="{BUTTON} pointer-events-none opacity-40">
				<Icon name="arrow-left" />新しい方へ
			</span>
		{/if}
		{#if older !== null}
			<a href="{page.url.pathname}?before={older}" class={BUTTON}>古い方へ<Icon name="arrow-right" /></a>
		{:else}
			<span aria-disabled="true" class="{BUTTON} pointer-events-none opacity-40">
				古い方へ<Icon name="arrow-right" />
			</span>
		{/if}
	</nav>
{/if}
