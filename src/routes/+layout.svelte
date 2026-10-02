<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import { markHydrated } from '$lib/display-date';

	let { data, children } = $props();

	onMount(markHydrated);

	// The catalogue draws each case's header from its fixture, not from the visitor's session.
	const catalogue = $derived(page.route.id?.startsWith('/dev/ui') ?? false);
</script>

<!-- A page's own <title> replaces this one: Svelte keeps only the deepest title. -->
<svelte:head>
	<title>Quorum</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-bg text-text">
	{#if data.user && !catalogue}
		<SiteHeader user={data.user} member={data.member} isAdmin={data.isAdmin} />
	{/if}
	{@render children()}
	<Toaster />
</div>
