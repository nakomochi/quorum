<script lang="ts">
	import Icon, { type IconName } from '$lib/icons/Icon.svelte';

	type Props = {
		/** The open question's place in the list, counted from 0. */
		index: number;
		/** False once the form holds as many questions as it may. */
		canAdd: boolean;
		/** Adds a blank question right after this one. */
		onadd: () => void;
		/** Copies this question right after itself. */
		onduplicate: () => void;
	};

	let { index, canAdd, onadd, onduplicate }: Props = $props();
</script>

{#snippet action(label: string, icon: IconName, onclick: () => void)}
	<button
		type="button"
		class="text-text-subtle hover:bg-surface-raised rounded-lg p-2 transition disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
		aria-label={label}
		title={label}
		disabled={!canAdd}
		{onclick}
	>
		<Icon name={icon} class="size-5" />
	</button>
{/snippet}

<!-- A row along the card's bottom edge on a phone. From md the page leaves a gutter to the right
     of the cards, and the bar floats there instead: the outer box spans the card's height so that
     the bar can stay in view while a tall card scrolls past. -->
<div
	class="border-border flex justify-end border-t pt-2 md:absolute md:inset-y-0 md:left-full md:ml-3 md:block md:border-t-0 md:pt-0"
>
	<div
		role="group"
		aria-label="質問 {index + 1} の操作"
		class="md:border-border md:bg-surface flex gap-1 md:sticky md:top-4 md:flex-col md:rounded-xl md:border md:p-1 md:shadow-sm"
	>
		{@render action('質問を追加', 'circle-plus', onadd)}
		{@render action('この質問を複製', 'copy', onduplicate)}
	</div>
</div>
