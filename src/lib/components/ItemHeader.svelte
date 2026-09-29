<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		/** The title's element: a heading where the row heads its own section. */
		tag?: 'span' | 'h1' | 'h2' | 'h3';
		titleClass?: string;
		/** Lets a long title wrap instead of cutting it off; the badges then sit on its first line. */
		wrap?: boolean;
		/** Leads the row. Brings its own `shrink-0`. */
		icon?: Snippet;
		/** `.badge`s, kept at the right end of the row. */
		badges?: Snippet;
		/** Controls after the badges. Bring their own `shrink-0`. */
		menu?: Snippet;
		class?: string;
	};

	let {
		title,
		tag = 'span',
		titleClass = 'font-medium',
		wrap = false,
		icon,
		badges,
		menu,
		class: className = ''
	}: Props = $props();
</script>

<div class="flex min-w-0 gap-2 {wrap ? 'items-baseline' : 'items-center'} {className}">
	{@render icon?.()}
	<svelte:element this={tag} class="min-w-0 flex-1 {wrap ? '' : 'truncate'} {titleClass}">
		{title}
	</svelte:element>
	{#if badges}
		<!-- Hidden while no badge's condition holds, so the gap goes with it. Not `:empty`: the
		     whitespace between the conditions is a text node. -->
		<span
			class="flex shrink-0 not-has-[*]:hidden {wrap
				? 'flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-1.5'
				: 'items-center gap-1.5'}">{@render badges()}</span
		>
	{/if}
	{#if menu}
		<!-- Takes no height of its own, so a control taller than the title does not make its row
		     taller than the rows without one: the next line starts the same distance below. Hidden
		     like the badges while it holds nothing. -->
		<div class="flex h-0 shrink-0 items-center self-center not-has-[*]:hidden">
			{@render menu()}
		</div>
	{/if}
</div>
