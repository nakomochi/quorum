<script lang="ts">
	import Icon from '$lib/icons/Icon.svelte';
	import type { ToastKind } from '$lib/toast.svelte';

	type Props = {
		kind: ToastKind;
		text: string;
		/** The close button's action. An error always has the button, since it never fades. */
		onclose?: () => void;
	};

	let { kind, text, onclose }: Props = $props();
</script>

<div role={kind === 'error' ? 'alert' : 'status'} class="toast toast-{kind}">
	<Icon name={kind === 'error' ? 'circle-alert' : 'circle-check'} class="mt-0.5 size-4 shrink-0" />
	<p class="min-w-0 flex-1">{text}</p>
	{#if kind === 'error'}
		<button
			type="button"
			aria-label="閉じる"
			class="-my-1 -mr-2 shrink-0 rounded p-1 opacity-80 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none"
			onclick={onclose}
		>
			<Icon name="x" />
		</button>
	{/if}
</div>
