<script lang="ts">
	import Icon from '$lib/icons/Icon.svelte';
	import type { ToastKind } from '$lib/toast.svelte';

	type Props = {
		kind: ToastKind;
		text: string;
		/** The close button's action. All but a success have the button, since they never fade. */
		onclose?: () => void;
	};

	let { kind, text, onclose }: Props = $props();

	const ICONS = {
		success: 'circle-check',
		error: 'circle-alert',
		warning: 'triangle-alert'
	} as const;

	const persistent = $derived(kind !== 'success');
</script>

<div role={persistent ? 'alert' : 'status'} class="toast toast-{kind}">
	<Icon name={ICONS[kind]} class="mt-0.5 size-4 shrink-0" />
	<p class="min-w-0 flex-1">{text}</p>
	{#if persistent}
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
