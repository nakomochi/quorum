<script lang="ts" module>
	/** `deleted` for a question an edit has removed: listed only where it was answered. */
	export type HistoryQuestion = {
		id: number;
		label: string;
		options: { id: string; label: string }[] | null;
		deleted?: boolean;
	};
</script>

<script lang="ts">
	import { describeAnswer, sameAnswer, type AnswerValue } from '$lib/forms';

	type Answers = Record<string, AnswerValue | undefined>;

	type Props = {
		questions: HistoryQuestion[];
		answers: Answers;
		/** The answers this one replaced. Given, a question whose answer differs is marked 変更. */
		previous?: Answers;
		/** Each question in a card of its own, for a list that stands alone on the page. */
		cards?: boolean;
		class?: string;
	};

	let { questions, answers, previous, cards = false, class: className = '' }: Props = $props();

	const shown = $derived(questions.filter((q) => !q.deleted || answers[q.id] !== undefined));

	const readable = (q: HistoryQuestion) => {
		const value = answers[q.id];
		return value ? describeAnswer(value, q.options) : '（未回答）';
	};

	const changed = (q: HistoryQuestion) =>
		previous !== undefined && !sameAnswer(answers[q.id], previous[q.id]);
</script>

<dl class="flex flex-col gap-3 {className}">
	{#each shown as q (q.id)}
		<div class={cards ? 'card p-5' : ''}>
			<dt class="flex items-start gap-2 text-sm font-medium">
				<span class="min-w-0 flex-1">
					{q.label}
					{#if q.deleted}
						<span class="font-normal text-text-muted">（削除された質問）</span>
					{/if}
				</span>
				{#if changed(q)}
					<span class="badge badge-warning">変更</span>
				{/if}
			</dt>
			<!-- On one line: the text keeps its own line breaks, and none may be added around it. -->
			<dd class="{cards ? 'mt-2' : 'mt-1'} text-text-subtle text-sm whitespace-pre-wrap">{readable(q)}</dd>
		</div>
	{/each}
</dl>
