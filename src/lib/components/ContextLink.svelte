<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import Icon from '$lib/icons/Icon.svelte';

	type Props = {
		href: ResolvedPathname;
		label: string;
		/** Where the arrow points: `back` puts it before the label, `forward` after. */
		direction: 'forward' | 'back';
	};

	let { href, label, direction }: Props = $props();
</script>

<nav class="self-start text-sm text-text-muted">
	<a {href} class="inline-flex items-center gap-1.5 hover:underline">
		{#if direction === 'back'}
			<Icon name="arrow-left" />
		{/if}
		{label}
		{#if direction === 'forward'}
			<Icon name="arrow-right" />
		{/if}
	</a>
</nav>
