<script lang="ts" module>
	/** "締切 2026/04/30 23:59", or a value alone such as "12 件の回答". */
	export type MetaItem = { label?: string; value: string };
</script>

<script lang="ts">
	type Props = {
		items: MetaItem[];
		class?: string;
	};

	let { items, class: className = '' }: Props = $props();
</script>

<!-- Inline text rather than flex, and a no-break space ahead of each ・: a wrap may come after the
     separator but never before it, so no line ever opens with one. -->
<p class="text-text-muted text-xs {className}">
	{#each items as item, index (index)}{index > 0 ? ' ・ ' : ''}<span
			class="whitespace-nowrap tabular-nums">{item.label ? `${item.label} ` : ''}{item.value}</span
		>{/each}
</p>
