<script lang="ts" module>
	import type { AnswerValue } from '$lib/forms';

	export type Revision = {
		number: number;
		createdAt: Date;
		answers: Record<string, AnswerValue | undefined>;
	};
</script>

<script lang="ts" generics="R extends Revision">
	import type { Snippet } from 'svelte';
	import { formatJst } from '$lib/datetime';
	import AnswerList from './AnswerList.svelte';
	import ItemHeader from './ItemHeader.svelte';
	import MetaLine from './MetaLine.svelte';

	type Question = { id: number; label: string; options: { id: string; label: string }[] | null };

	type Props = {
		/** Newest first. */
		revisions: R[];
		questions: Question[];
		/** The element of each "N版目", one level below the heading the list sits under. */
		headingTag: 'h2' | 'h3';
		/** Marks the questions each revision changed from the one before it. */
		showChanges?: boolean;
		/** Controls at the right end of a revision's title row. Bring their own `shrink-0`. */
		actions?: Snippet<[revision: R, index: number]>;
	};

	let { revisions, questions, headingTag, showChanges = false, actions }: Props = $props();
</script>

<ol class="flex flex-col gap-3">
	{#each revisions as revision, index (revision.number)}
		<li class="card p-5">
			<ItemHeader
				title="{revision.number}版目"
				tag={headingTag}
				titleClass="text-sm font-semibold"
			>
				{#snippet badges()}
					{#if index === 0}<span class="badge badge-success">最新</span>{/if}
					{#if revision.number === 1}<span class="badge badge-muted">初回提出</span>{/if}
				{/snippet}
				{#snippet menu()}
					{@render actions?.(revision, index)}
				{/snippet}
			</ItemHeader>
			<!-- mt-1.5: clears the button a row may hold, which reaches past its row. -->
			<MetaLine
				class="mt-1.5"
				items={[
					{ label: revision.number === 1 ? '提出' : '更新', value: formatJst(revision.createdAt) }
				]}
			/>
			<AnswerList
				class="mt-4"
				{questions}
				answers={revision.answers}
				previous={showChanges ? revisions[index + 1]?.answers : undefined}
			/>
		</li>
	{/each}
</ol>
