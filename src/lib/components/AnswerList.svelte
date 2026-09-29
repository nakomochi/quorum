<script lang="ts">
	import { describeAnswer, sameAnswer, type AnswerValue } from '$lib/forms';

	type Question = { id: number; label: string; options: { id: string; label: string }[] | null };
	type Answers = Record<string, AnswerValue | undefined>;

	type Props = {
		questions: Question[];
		answers: Answers;
		/** The answers this one replaced. Given, a question whose answer differs is marked 変更. */
		previous?: Answers;
		/** Each question in a card of its own, for a list that stands alone on the page. */
		cards?: boolean;
		class?: string;
	};

	let { questions, answers, previous, cards = false, class: className = '' }: Props = $props();

	const readable = (q: Question) => {
		const value = answers[q.id];
		return value ? describeAnswer(value, q.options) : '（未回答）';
	};

	const changed = (q: Question) =>
		previous !== undefined && !sameAnswer(answers[q.id], previous[q.id]);
</script>

<dl class="flex flex-col gap-3 {className}">
	{#each questions as q (q.id)}
		<div class={cards ? 'card p-5' : ''}>
			<dt class="flex items-start gap-2 text-sm font-medium">
				<span class="min-w-0 flex-1">{q.label}</span>
				{#if changed(q)}
					<span class="badge badge-warning">変更</span>
				{/if}
			</dt>
			<!-- On one line: the text keeps its own line breaks, and none may be added around it. -->
			<dd class="{cards ? 'mt-2' : 'mt-1'} text-text-subtle text-sm whitespace-pre-wrap">{readable(q)}</dd>
		</div>
	{/each}
</dl>
