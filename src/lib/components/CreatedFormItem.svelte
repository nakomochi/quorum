<script lang="ts">
	import ItemHeader from '$lib/components/ItemHeader.svelte';
	import MetaLine from '$lib/components/MetaLine.svelte';
	import RowMenu from '$lib/components/RowMenu.svelte';
	import { FORM_STATUS_LABELS, type FormStatus } from '$lib/forms';
	import Icon, { type IconName } from '$lib/icons/Icon.svelte';
	import { deadlineItem, UNDER_ICON } from './form-rows';

	type Props = {
		row: {
			id: string;
			title: string;
			deadline: Date | null;
			responseCount: number;
			status: FormStatus;
		};
	};

	let { row }: Props = $props();

	const STATUS_ICONS: Record<FormStatus, { name: IconName; tone: string }> = {
		open: { name: 'clock', tone: 'text-accent' },
		ended: { name: 'hourglass', tone: 'text-warning' },
		closed: { name: 'lock', tone: 'text-text-muted' }
	};

	const status = $derived(STATUS_ICONS[row.status]);
</script>

<li class="card flex items-center gap-2 pr-3">
	<a href="/forms/{row.id}/results" class="flex min-w-0 flex-1 flex-col gap-1 py-4 pl-5">
		<ItemHeader title={row.title}>
			{#snippet icon()}
				<!-- The icon's shape and label carry the status, so no text badge repeats it. -->
				<span
					role="img"
					aria-label={FORM_STATUS_LABELS[row.status]}
					title={FORM_STATUS_LABELS[row.status]}
					class="flex shrink-0"
				>
					<Icon name={status.name} class="{status.tone} size-4" />
				</span>
			{/snippet}
		</ItemHeader>
		<MetaLine
			class={UNDER_ICON}
			items={[deadlineItem(row.deadline), { label: '回答', value: `${row.responseCount}名` }]}
		/>
	</a>
	<!-- 複製 is the results page's own action: it redirects to the new draft. A closed form is
	     reopened before it is edited. -->
	<RowMenu
		label="「{row.title}」の操作"
		items={[
			...(row.status === 'closed'
				? []
				: [{ kind: 'link' as const, label: '編集', href: `/forms/${row.id}/edit` }]),
			{ kind: 'post', label: '複製', action: `/forms/${row.id}/results?/duplicate` }
		]}
	/>
</li>
