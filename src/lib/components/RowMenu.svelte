<script lang="ts">
	import Menu, { type MenuItem } from '$lib/components/Menu.svelte';
	import Icon from '$lib/icons/Icon.svelte';

	/** The ⋯ menu at the right end of a list row. */
	let { label, items }: { label: string; items: MenuItem[] } = $props();
</script>

<Menu
	{label}
	{items}
	triggerClass="text-text-muted hover:bg-surface-raised hover:text-text-subtle focus-visible:ring-accent/60 rounded-lg p-2 outline-none focus-visible:ring-2"
>
	{#snippet trigger()}
		<Icon name="ellipsis" />
	{/snippet}
</Menu>
