<script lang="ts">
	type Props = {
		/** Named by the field's aria-describedby. */
		id?: string;
		/** Nothing is drawn while null. */
		message: string | null;
		class?: string;
	};

	let { id, message, class: className = '' }: Props = $props();
</script>

{#if message}
	<p {id} role="alert" class="text-danger text-xs {className}">{message}</p>
{/if}
