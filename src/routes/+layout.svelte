<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import SiteHeader from '$lib/components/SiteHeader.svelte';

	let { data, children } = $props();

	// The catalogue draws each case's header from its fixture, not from the visitor's session.
	const catalogue = $derived(page.route.id?.startsWith('/dev/ui') ?? false);
</script>

<!-- A page's own <title> replaces this one: Svelte keeps only the deepest title. -->
<svelte:head>
	<title>Quorum</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="bg-bg text-text min-h-screen">
	{#if data.user && !catalogue}
		<SiteHeader user={data.user} member={data.member} isAdmin={data.isAdmin} />
	{/if}
	{@render children()}
</div>
