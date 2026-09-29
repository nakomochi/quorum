<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';

	type Props = {
		/** A heading where the panel is a section of the page; `p` for a frame around one link. */
		labelTag?: 'h2' | 'p';
		class?: string;
		children: Snippet;
	};

	let { labelTag = 'h2', class: className = '', children }: Props = $props();
</script>

<section class="panel-admin {className}">
	<svelte:element this={labelTag} class="panel-admin-title">
		<Icon name="lock" class="size-3.5 shrink-0" />
		管理（作成者・管理者のみ）
	</svelte:element>
	{@render children()}
</section>
