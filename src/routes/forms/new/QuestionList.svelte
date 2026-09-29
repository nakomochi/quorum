<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { dragHandleZone, type DndEvent } from 'svelte-dnd-action';
	import { MAX_QUESTIONS, type InputError } from '$lib/forms';
	import Icon from '$lib/icons/Icon.svelte';
	import { duplicateQuestion, FLIP_MS, newQuestion, type EditorQuestion } from './editor';
	import type { HistoryControls } from './history.svelte';
	import QuestionCard from './QuestionCard.svelte';
	import QuestionPreview from './QuestionPreview.svelte';
	import QuestionToolbar from './QuestionToolbar.svelte';

	type Props = {
		questions: EditorQuestion[];
		history: HistoryControls;
		/** The last submission's rejected input, drawn in the card of the question it names. */
		inputError: InputError | null;
	};

	let { questions = $bindable(), history, inputError }: Props = $props();

	// By place, as the server counted the list it was sent. Left there until the next result.
	const errorOf = (index: number) =>
		inputError?.at && 'question' in inputError.at && inputError.at.question === index
			? inputError.message
			: null;

	// The open card. Kept out of the history: undo and redo change the form, not where the admin is
	// looking. Held by id, so a question that undo or redo takes away closes with it, and opens
	// again if it comes back.
	let selectedId = $state(untrack(() => questions[0].id));
	const selected = $derived(questions.some((q) => q.id === selectedId) ? selectedId : null);

	const canAdd = $derived(questions.length < MAX_QUESTIONS);

	let zone: HTMLElement;

	const cardOf = (id: string) =>
		[...zone.children].find(
			(el): el is HTMLElement => el instanceof HTMLElement && el.dataset.questionId === id
		);

	async function open(id: string, then: 'focus' | 'reveal') {
		selectedId = id;
		await tick();
		const card = cardOf(id);
		if (then === 'reveal') card?.scrollIntoView({ block: 'center' });
		else card?.querySelector<HTMLInputElement>('[data-question-label]')?.focus();
	}

	/** Opens the question at `index` and scrolls it into view. */
	export async function reveal(index: number) {
		const q = questions[index];
		if (q) await open(q.id, 'reveal');
	}

	function insert(index: number, question: EditorQuestion) {
		history.step(
			() => (questions = [...questions.slice(0, index + 1), question, ...questions.slice(index + 1)])
		);
		open(question.id, 'focus');
	}

	function move(index: number, delta: number) {
		const to = index + delta;
		if (to < 0 || to >= questions.length) return;
		history.step(() => {
			const next = [...questions];
			[next[index], next[to]] = [next[to], next[index]];
			questions = next;
		});
	}

	// Closing the open card hands the selection to its neighbour above, as Google Forms does.
	// Compared with `selectedId`: `selected` already reads null once the question is gone.
	function remove(index: number) {
		const id = questions[index].id;
		history.step(() => (questions = questions.filter((item) => item.id !== id)));
		if (id === selectedId) selectedId = questions[Math.max(0, index - 1)].id;
	}

	// Both events must be handled: `consider` opens the gap, `finalize` commits the drop.
	function onDnd(event: CustomEvent<DndEvent<EditorQuestion>>) {
		questions = event.detail.items;
		history.checkpoint();
	}
</script>

<section class="flex flex-col gap-4">
	<div class="flex items-center justify-between gap-2">
		<h2 class="section-title">質問</h2>
		<div class="flex gap-1">
			<!-- Ctrl+Z does the same, but a phone has no Ctrl and a shortcut is invisible. -->
			<button
				type="button"
				class="chip p-1.5"
				aria-label="元に戻す"
				title="元に戻す"
				disabled={!history.canUndo}
				onclick={history.undo}
			>
				<Icon name="undo-2" />
			</button>
			<button
				type="button"
				class="chip p-1.5"
				aria-label="やり直す"
				title="やり直す"
				disabled={!history.canRedo}
				onclick={history.redo}
			>
				<Icon name="redo-2" />
			</button>
		</div>
	</div>

	<!-- The zone's children must be the questions and nothing else, hence the extra wrapper. -->
	<div
		bind:this={zone}
		class="flex flex-col gap-4"
		use:dragHandleZone={{ items: questions, flipDurationMs: FLIP_MS, dropTargetStyle: {} }}
		onconsider={onDnd}
		onfinalize={onDnd}
	>
		{#each questions as q, index (q.id)}
			<!-- The open card is marked by an accent band down its left edge, border included. -->
			<div
				data-question-id={q.id}
				class={[
					'card relative flex flex-col gap-3 p-5',
					q.id === selected && 'border-l-accent shadow-[inset_5px_0_0_0_var(--color-accent)]'
				]}
				animate:flip={{ duration: FLIP_MS }}
			>
				{#if q.id === selected}
					<QuestionCard
						bind:question={questions[index]}
						{index}
						count={questions.length}
						{history}
						error={errorOf(index)}
						onmove={(delta) => move(index, delta)}
						onremove={() => remove(index)}
					/>
					<QuestionToolbar
						{index}
						{canAdd}
						onadd={() => insert(index, newQuestion())}
						onduplicate={() => insert(index, duplicateQuestion(q))}
					/>
				{:else}
					<QuestionPreview
						question={q}
						{index}
						error={errorOf(index)}
						onselect={() => open(q.id, 'focus')}
					/>
				{/if}
			</div>
		{/each}
	</div>
</section>
