<script lang="ts">
	import ItemHeader from '$lib/components/ItemHeader.svelte';
	import MetaLine from '$lib/components/MetaLine.svelte';
	import { displayJst } from '$lib/display-date';
	import type { PageData } from './$types';

	type Props = {
		form: PageData['form'];
		closed: boolean;
		submitted: boolean;
	};

	let { form, closed, submitted }: Props = $props();
</script>

<!-- The accent bar is a clipped child, not a `border-t-4`: the rounded top corners would
     otherwise render the border as a thickening wedge. -->
<header class="card overflow-hidden">
	<div class="h-1.5 bg-accent"></div>
	<div class="p-6">
		<ItemHeader title={form.title} tag="h1" titleClass="page-title text-2xl" wrap>
			{#snippet badges()}
				{#if closed}<span class="badge badge-muted">受付終了</span>{/if}
				{#if submitted}<span class="badge badge-success">提出済み</span>{/if}
			{/snippet}
		</ItemHeader>
		{#if form.description}
			<p class="mt-2 text-sm whitespace-pre-wrap text-text-subtle">{form.description}</p>
		{/if}
		<MetaLine
			class="mt-4"
			items={[
				{ label: '締切', value: displayJst(form.deadline, 'なし') },
				{ label: '受付終了', value: displayJst(form.closesAt, '指定なし') }
			]}
		/>
	</div>
</header>
