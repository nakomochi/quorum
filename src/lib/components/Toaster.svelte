<script lang="ts">
	import { fly } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { page } from '$app/state';
	import { toastOf } from '$lib/action-toast';
	import { toast } from '$lib/toast.svelte';
	import ToastItem from './ToastItem.svelte';

	// Every action result reaches here once, however the form was posted: a full POST sets it for the
	// hydrating page, and use:enhance through applyAction. A reload of the data keeps the same object.
	let shown: unknown = null;

	$effect(() => {
		const result = page.form;
		if (!result || result === shown) return;
		shown = result;
		const item = toastOf(result);
		if (item) toast[item.kind](item.text);
	});
</script>

<!-- Always in the document; each toast is read out through its own role, alert or status. -->
<div class="toast-region">
	{#each toast.items as item (item.id)}
		<div
			class="pointer-events-auto"
			transition:fly={{ y: 8, duration: prefersReducedMotion.current ? 0 : 150 }}
		>
			<ToastItem kind={item.kind} text={item.text} onclose={() => toast.dismiss(item.id)} />
		</div>
	{/each}
</div>
