<script lang="ts">
	import { flip } from 'svelte/animate';
	import { dragHandleZone, type DndEvent } from 'svelte-dnd-action';
	import Icon from '$lib/icons/Icon.svelte';
	import { FLIP_MS, newQuestion, type EditorQuestion } from './editor';
	import type { HistoryControls } from './history.svelte';
	import QuestionCard from './QuestionCard.svelte';

	type Props = {
		questions: EditorQuestion[];
		history: HistoryControls;
	};

	let { questions = $bindable(), history }: Props = $props();

	function move(index: number, delta: number) {
		const to = index + delta;
		if (to < 0 || to >= questions.length) return;
		history.step(() => {
			const next = [...questions];
			[next[index], next[to]] = [next[to], next[index]];
			questions = next;
		});
	}

	const remove = (id: string) =>
		history.step(() => (questions = questions.filter((item) => item.id !== id)));

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
			<button
				type="button"
				class="chip"
				onclick={() => history.step(() => (questions = [...questions, newQuestion()]))}
			>
				質問を追加
			</button>
		</div>
	</div>

	<!-- The zone's children must be the questions and nothing else, hence the extra wrapper. -->
	<div
		class="flex flex-col gap-4"
		use:dragHandleZone={{ items: questions, flipDurationMs: FLIP_MS, dropTargetStyle: {} }}
		onconsider={onDnd}
		onfinalize={onDnd}
	>
		{#each questions as q, index (q.id)}
			<div class="card flex flex-col gap-3 p-5" animate:flip={{ duration: FLIP_MS }}>
				<QuestionCard
					bind:question={questions[index]}
					{index}
					count={questions.length}
					{history}
					onmove={(delta) => move(index, delta)}
					onremove={() => remove(q.id)}
				/>
			</div>
		{/each}
	</div>
</section>
