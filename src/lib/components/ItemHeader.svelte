<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		/** The title's element: a heading where the row heads its own section. */
		tag?: 'span' | 'h1' | 'h2' | 'h3';
		titleClass?: string;
		/**
		 * Lets a long title wrap instead of cutting it off. The badges stay centred on the whole
		 * block; only where the title would be left narrower than 8em do they move below it.
		 */
		wrap?: boolean;
		/** Leads the row. Brings its own `shrink-0`. */
		icon?: Snippet;
		/** `.badge`s, kept in one line at the right end of the row. */
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

<!-- `items-center` centres the badges on the title's whole block, however many lines it takes.
     A wrapping title bases its width on 8em of its own font, so the row breaks before the badges
     squeeze it into a column of a few characters; `ml-auto` then keeps them at the right end. -->
<div class="flex min-w-0 items-center gap-2 {wrap ? 'flex-wrap' : ''} {className}">
	{@render icon?.()}
	<svelte:element
		this={tag}
		class="min-w-0 {wrap ? 'flex-[1_1_8em]' : 'flex-1 truncate'} {titleClass}"
	>
		{title}
	</svelte:element>
	{#if badges}
		<!-- Hidden while no badge's condition holds, so the gap goes with it. Not `:empty`: the
		     whitespace between the conditions is a text node. -->
		<span class="ml-auto flex shrink-0 items-center gap-1.5 not-has-[*]:hidden"
			>{@render badges()}</span
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
