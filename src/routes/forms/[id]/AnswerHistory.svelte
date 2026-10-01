<script lang="ts">
	import type { HistoryQuestion } from '$lib/components/AnswerList.svelte';
	import RevisionList from '$lib/components/RevisionList.svelte';
	import type { PageData } from './$types';

	type Revision = PageData['history'][number];

	type Props = {
		/** The viewer's own revisions, newest first. */
		revisions: Revision[];
		/** The live questions, then the deleted ones some revision answered. */
		questions: HistoryQuestion[];
		/** Offers to load an older revision into the form. */
		canEdit: boolean;
		onload: (revision: Revision) => void;
	};

	let { revisions, questions, canEdit, onload }: Props = $props();
</script>

<section class="flex flex-col gap-3">
	<h2 class="section-title">回答履歴</h2>
	<RevisionList {revisions} {questions} headingTag="h3">
		{#snippet actions(revision, index)}
			{#if canEdit && index > 0}
				<button type="button" class="btn-secondary btn-sm shrink-0" onclick={() => onload(revision)}>
					この内容を読み込む
				</button>
			{/if}
		{/snippet}
	</RevisionList>
</section>
