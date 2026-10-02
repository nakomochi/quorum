<script lang="ts">
	import { resolve } from '$app/paths';
	import ItemHeader from '$lib/components/ItemHeader.svelte';
	import MetaLine from '$lib/components/MetaLine.svelte';
	import { displayJst } from '$lib/display-date';
	import Icon from '$lib/icons/Icon.svelte';
	import { UNDER_ICON } from './form-rows';

	type Props = {
		row: { id: string; title: string; submittedAt: Date; revisionCount: number };
	};

	let { row }: Props = $props();
</script>

<li class="card">
	<a href={resolve('/forms/[id]', { id: row.id })} class="flex flex-col gap-1 px-5 py-4">
		<ItemHeader title={row.title} titleClass="text-text-subtle">
			{#snippet icon()}
				<Icon name="check" class="text-success size-4 shrink-0" />
			{/snippet}
			{#snippet badges()}
				{#if row.revisionCount > 1}
					<span class="badge badge-muted">編集済み</span>
				{/if}
			{/snippet}
		</ItemHeader>
		<MetaLine class={UNDER_ICON} items={[{ label: '提出', value: displayJst(row.submittedAt) }]} />
	</a>
</li>
