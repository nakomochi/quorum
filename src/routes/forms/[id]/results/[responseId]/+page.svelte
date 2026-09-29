<script lang="ts">
	import ContextLink from '$lib/components/ContextLink.svelte';
	import MetaLine from '$lib/components/MetaLine.svelte';
	import RevisionList from '$lib/components/RevisionList.svelte';
	import { formatJst } from '$lib/datetime';

	let { data } = $props();
</script>

<main class="page">
	<div class="flex flex-col gap-3">
		<ContextLink href="/forms/{data.form.id}/results" label="回答状況へ戻る" direction="back" />

		<header>
			<h1 class="page-title">{data.response.displayName} さんの回答履歴</h1>
			<p class="mt-1 text-sm text-text-muted">{data.form.title}</p>
			<MetaLine
				class="mt-2"
				items={[
					{ label: '提出', value: formatJst(data.response.submittedAt) },
					{ label: '更新', value: formatJst(data.response.updatedAt) }
				]}
			/>
		</header>
	</div>

	<RevisionList
		revisions={data.revisions}
		questions={data.questions}
		headingTag="h2"
		showChanges
	/>
</main>
