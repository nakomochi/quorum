<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import Icon from '$lib/icons/Icon.svelte';

	// The browser's own arrow and inner padding differ from SearchSelect's, so this draws the same
	// chevron in the same place instead. `class` goes on the wrapper, for margins.
	let {
		value = $bindable(),
		class: className = '',
		children,
		...rest
	}: HTMLSelectAttributes = $props();
</script>

<span class="relative block {className}">
	<select bind:value {...rest} class="field appearance-none pr-9">
		{@render children?.()}
	</select>
	<Icon
		name="chevron-down"
		class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-text-muted"
	/>
</span>
