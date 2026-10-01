<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';

	type Props = {
		/** A heading where the panel is a section of the page; `span` for a frame around one link. */
		labelTag?: 'h2' | 'span';
		/** Tighter padding, for a frame around a single control. */
		compact?: boolean;
		/** Closed unless the page opens it. A native toggle, so it works before hydration too. */
		open?: boolean;
		/**
		 * What waits for the manager inside, one short sentence each. The closed summary counts them,
		 * and a screen reader hears them as its description.
		 */
		attention?: string[];
		class?: string;
		children: Snippet;
	};

	let {
		labelTag = 'h2',
		compact = false,
		open = $bindable(false),
		attention = [],
		class: className = '',
		children
	}: Props = $props();

	const id = $props.id();
</script>

<details class="panel-admin group/admin {className}" bind:open>
	<!-- The browser's own marker is replaced by the chevron, held at the right end out of the flow:
	     on a phone the mark wraps under the label, and the chevron stays put. A summary may hold
	     only phrasing and heading content, so no wrapper box can do that. -->
	<summary
		class="relative flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-xl outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden {compact
			? 'py-2 pr-9 pl-3'
			: 'py-3 pr-10 pl-4 sm:pr-11 sm:pl-5'}"
		aria-describedby={attention.length > 0 ? `${id}-attention` : undefined}
	>
		<svelte:element this={labelTag} class="panel-admin-title whitespace-nowrap">
			<Icon name="lock" class="size-3.5 shrink-0" />
			管理（作成者・管理者のみ）
		</svelte:element>
		{#if attention.length > 0}
			<span class="badge badge-warning gap-1">
				<Icon name="triangle-alert" class="size-3.5 shrink-0" />
				要対応 {attention.length}件
			</span>
			<span id="{id}-attention" hidden>{attention.join('、')}</span>
		{/if}
		<span
			class="absolute top-1/2 -translate-y-1/2 text-text-muted {compact
				? 'right-3'
				: 'right-4 sm:right-5'}"
		>
			<Icon
				name="chevron-down"
				class="size-4 transition-transform group-open/admin:rotate-180 motion-reduce:transition-none"
			/>
		</span>
	</summary>
	<div class={compact ? 'px-3 pb-2' : 'px-4 pb-5 sm:px-5'}>
		{@render children()}
	</div>
</details>
