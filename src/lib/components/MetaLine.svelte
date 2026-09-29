<script lang="ts" module>
	/** "締切 2026/04/30 23:59", "回答 12名", or a value alone. */
	export type MetaItem = { label?: string; value: string };
</script>

<script lang="ts">
	type Props = {
		items: MetaItem[];
		class?: string;
	};

	let { items, class: className = '' }: Props = $props();
</script>

<!-- Every item leads with its own ・, and the row is pulled left by one separator's width and
     clipped there. The separator that opens a line falls outside the clip, so no line starts or
     ends with one however the items wrap. The separators are drawn only: not read out, not copied. -->
<p class="text-text-muted text-xs {className}">
	<span class="-ml-[1.5em] flex flex-wrap [clip-path:inset(0_0_0_1.5em)]">
		{#each items as item, index (index)}
			<span class="whitespace-nowrap tabular-nums"
				><span aria-hidden="true" class="inline-block w-[1.5em] text-center select-none">・</span
				>{item.label ? `${item.label} ` : ''}{item.value}</span
			>
		{/each}
	</span>
</p>
