<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';

	type Props = {
		/**
		 * Folded behind its label, a native toggle that works before hydration too. Otherwise an
		 * always open frame around a single control, which sits on the label's line.
		 */
		collapsible?: boolean;
		/** A heading where the panel is a section of the page; `span` for a frame around one link. */
		labelTag?: 'h2' | 'span';
		/** Collapsible only. Closed unless the page opens it. */
		open?: boolean;
		/**
		 * Collapsible only. What waits for the manager inside, one short sentence each. The closed
		 * summary marks them with an icon that lists them on hover, and a screen reader hears them as
		 * its description.
		 */
		attention?: string[];
		class?: string;
		children: Snippet;
	};

	let {
		collapsible = false,
		labelTag = 'h2',
		open = $bindable(false),
		attention = [],
		class: className = '',
		children
	}: Props = $props();

	const id = $props.id();
</script>

{#snippet label()}
	<svelte:element this={labelTag} class="panel-admin-title whitespace-nowrap">
		<Icon name="lock" class="size-3.5 shrink-0" />
		管理（作成者・管理者のみ）
	</svelte:element>
{/snippet}

{#if collapsible}
	<details class="panel-admin group/admin {className}" bind:open>
		<!-- The browser's own marker is replaced by the chevron at the right end. -->
		<summary
			class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:px-5 [&::-webkit-details-marker]:hidden"
			aria-describedby={attention.length > 0 ? `${id}-attention` : undefined}
		>
			{@render label()}
			<span class="flex shrink-0 items-center gap-2">
				{#if attention.length > 0}
					<span class="text-warning" title={attention.join('\n')}>
						<Icon name="triangle-alert" class="size-4" />
					</span>
					<span id="{id}-attention" hidden>要対応: {attention.join('、')}</span>
				{/if}
				<Icon
					name="chevron-down"
					class="size-4 text-text-muted transition-transform group-open/admin:rotate-180 motion-reduce:transition-none"
				/>
			</span>
		</summary>
		<div class="px-4 pb-5 sm:px-5">
			{@render children()}
		</div>
	</details>
{:else}
	<section class="panel-admin flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 {className}">
		{@render label()}
		{@render children()}
	</section>
{/if}
