<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		/** The title's element: a heading where the row heads its own section. */
		tag?: 'span' | 'h1' | 'h2' | 'h3';
		titleClass?: string;
		/**
		 * Lets a long title wrap instead of cutting it off. The badges stay beside its first line;
		 * only where the title would be left narrower than 8em do they move below it, at the left.
		 */
		wrap?: boolean;
		/** Leads the row. Brings its own `shrink-0`. */
		icon?: Snippet;
		/** `.badge`s, kept in one line at the right end of the title's first line. */
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

<!-- A wrapping title bases its width on 8em of its own font, so the row breaks before the badges
     squeeze it into a column of a few characters. The title grows to fill its line, which keeps
     the badges at the right end beside it and at the left once they are on a line of their own.
     No row gap: the badges' own line already leaves room above them (see the strut below). -->
<div class="flex min-w-0 items-center gap-x-2 {wrap ? 'flex-wrap' : ''} {className}">
	{@render icon?.()}
	<svelte:element
		this={tag}
		class="min-w-0 {wrap ? 'flex-[1_1_8em]' : 'flex-1 truncate'} {titleClass}"
	>
		{title}
	</svelte:element>
	{#if badges}
		<!-- `self-start` and the strut centre the badges on the title's first line, not on its whole
		     block: the strut takes the title's font, so it is one of its lines tall. Its negative
		     margin lifts that centre by 1/12 of the title's size (2px at 24px), since the title's
		     glyphs are drawn above the middle of its line box by more than a badge's are (measured
		     on screen). A strut the badges outgrow, as with `text-sm`, leaves them centred as they
		     were. Hidden while no badge's condition holds, so the gap goes with it. -->
		<span class="flex shrink-0 items-center self-start not-has-[.badge]:hidden">
			<span aria-hidden="true" class="-mt-[calc(1em/6)] h-lh {titleClass}"></span>
			<span class="flex items-center gap-1.5">{@render badges()}</span>
		</span>
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
