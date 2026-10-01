<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { dragHandleZone, type DndEvent } from 'svelte-dnd-action';
	import { MAX_QUESTIONS, type InputError } from '$lib/forms';
	import { duplicateQuestion, FLIP_MS, newQuestion, type EditorQuestion } from './editor';
	import type { HistoryControls } from './history.svelte';
	import QuestionCard from './QuestionCard.svelte';
	import QuestionPreview from './QuestionPreview.svelte';
	import QuestionToolbar, { type ToolbarAction } from './QuestionToolbar.svelte';

	type Props = {
		questions: EditorQuestion[];
		history: HistoryControls;
		/** The last submission's rejected input, drawn in the card of the question it names. */
		inputError: InputError | null;
		/** The published questions keep their types. Those added in the editor never do. */
		typesLocked: boolean;
	};

	let { questions = $bindable(), history, inputError, typesLocked }: Props = $props();

	// By place, as the server counted the list it was sent. Left there until the next result.
	const errorOf = (index: number) =>
		inputError?.at && 'question' in inputError.at && inputError.at.question === index
			? inputError.message
			: null;

	// The open card. Kept out of the history: undo and redo change the form, not where the admin is
	// looking. Held by id, so a question that undo or redo takes away hands the card to the one
	// above it, as deleting does, and opens again if it comes back. One card is always open: the
	// toolbar, undo and redo included, is drawn in it.
	let selectedId = $state(untrack(() => questions[0].id));
	// Where the open question last stood, to find the one above it once it is gone.
	let lastIndex = 0;
	const selected = $derived.by(() => {
		const index = questions.findIndex((q) => q.id === selectedId);
		if (index !== -1) lastIndex = index;
		const at = index !== -1 ? index : Math.min(Math.max(0, lastIndex - 1), questions.length - 1);
		return questions[at]?.id ?? null;
	});

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

	// The moved card stays open.
	function move(index: number, delta: number) {
		const to = index + delta;
		if (to < 0 || to >= questions.length) return;
		selectedId = questions[index].id;
		history.step(() => {
			const next = [...questions];
			[next[index], next[to]] = [next[to], next[index]];
			questions = next;
		});
	}

	// Only the open card can be deleted, and the selection goes to its neighbour above, as Google
	// Forms does.
	function remove(index: number) {
		const id = questions[index].id;
		history.step(() => (questions = questions.filter((item) => item.id !== id)));
		selectedId = questions[Math.max(0, index - 1)].id;
	}

	// The button that takes focus when the one pressed has gone dead, so that a keyboard can go on.
	const PARTNER: Partial<Record<ToolbarAction, ToolbarAction>> = {
		up: 'down',
		down: 'up',
		undo: 'redo',
		redo: 'undo'
	};

	/**
	 * Puts focus back on the toolbar button pressed: a move can take the card out of the document
	 * for a moment, and a deletion or undo can hand the toolbar to another card. A disabled button
	 * hands it to its partner, or else to the first that is not.
	 */
	async function refocus(action: ToolbarAction, preventScroll: boolean) {
		await tick();
		const buttons = [
			...zone.querySelectorAll<HTMLButtonElement>('[data-question-toolbar] [data-toolbar-action]')
		].filter((button) => !button.disabled);
		const find = (name: ToolbarAction | undefined) =>
			buttons.find((button) => button.dataset.toolbarAction === name);
		(find(action) ?? find(PARTNER[action]) ?? buttons[0])?.focus({ preventScroll });
	}

	/** Scrolls the moved card into view once animate:flip has brought it to where it now stands. */
	async function follow(id: string) {
		const card = cardOf(id);
		if (!card) return;
		await Promise.all(card.getAnimations().map((animation) => animation.finished.catch(() => {})));
		card.scrollIntoView({ block: 'nearest' });
		// A card taller than the window can leave its toolbar out of view.
		const focused = document.activeElement;
		if (focused instanceof HTMLElement && card.contains(focused)) {
			focused.scrollIntoView({ block: 'nearest' });
		}
	}

	async function act(index: number, action: ToolbarAction) {
		const q = questions[index];
		switch (action) {
			case 'add':
				return insert(index, newQuestion());
			case 'duplicate':
				return insert(index, duplicateQuestion(q));
			case 'up':
			case 'down':
				move(index, action === 'up' ? -1 : 1);
				await refocus(action, true);
				return follow(q.id);
			case 'remove':
				remove(index);
				break;
			case 'undo':
				history.undo();
				break;
			case 'redo':
				history.redo();
				break;
		}
		await refocus(action, false);
	}

	// Both events must be handled: `consider` opens the gap, `finalize` commits the drop.
	function onDnd(event: CustomEvent<DndEvent<EditorQuestion>>) {
		questions = event.detail.items;
		history.checkpoint();
	}
</script>

<section class="flex flex-col gap-4">
	<h2 class="section-title">質問</h2>

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
						{history}
						error={errorOf(index)}
						typeLocked={typesLocked && q.sourceId !== null}
					/>
					<QuestionToolbar
						{index}
						count={questions.length}
						{canAdd}
						{history}
						onaction={(action) => act(index, action)}
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
