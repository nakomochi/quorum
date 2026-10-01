<script lang="ts">
	import { flip } from 'svelte/animate';
	import { dragHandle, dragHandleZone, type DndEvent } from 'svelte-dnd-action';
	import { MAX_OPTION_LABEL } from '$lib/forms';
	import Icon from '$lib/icons/Icon.svelte';
	import { FLIP_MS, newOption, type EditorOption, type EditorQuestion } from './editor';
	import type { HistoryControls } from './history.svelte';

	type Props = {
		/** The question whose options and "その他" are edited. */
		question: EditorQuestion;
		/** The question's place in the list, counted from 0. */
		index: number;
		history: HistoryControls;
	};

	let { question = $bindable(), index, history }: Props = $props();

	// A type of its own per question keeps options inside their card and out of the question list.
	const zoneType = $derived(`option:${question.id}`);

	// Both events must be handled: `consider` opens the gap, `finalize` commits the drop.
	function onDnd(event: CustomEvent<DndEvent<EditorOption>>) {
		question.options = event.detail.items;
		history.checkpoint();
	}
</script>

<div class="border-border flex flex-col gap-2 border-t pt-3">
	<!-- Nested zone: its own type, so an option can never land in the question list. -->
	<div
		class="flex flex-col gap-2"
		use:dragHandleZone={{
			items: question.options,
			type: zoneType,
			flipDurationMs: FLIP_MS,
			dropTargetStyle: {}
		}}
		onconsider={onDnd}
		onfinalize={onDnd}
	>
		{#each question.options as option, optionIndex (option.id)}
			<div class="flex items-center gap-2" animate:flip={{ duration: FLIP_MS }}>
				<div
					use:dragHandle
					aria-label="質問 {index + 1} の選択肢 {optionIndex + 1} をドラッグして並び替え"
					class="outline-accent shrink-0 touch-none rounded p-1 text-text-muted hover:text-text-subtle focus-visible:-outline-offset-2 focus-visible:outline-2"
				>
					<Icon name="grip-vertical" />
				</div>
				<input
					bind:value={option.label}
					aria-label="質問 {index + 1} の選択肢 {optionIndex + 1}"
					placeholder="選択肢"
					required
					maxlength={MAX_OPTION_LABEL}
					class="field min-w-0"
				/>
				<button
					type="button"
					class="chip p-1.5"
					aria-label="質問 {index + 1} の選択肢 {optionIndex + 1} を削除"
					disabled={question.options.length === 1}
					onclick={() =>
						history.step(
							() => (question.options = question.options.filter((item) => item.id !== option.id))
						)}
				>
					<Icon name="x" />
				</button>
				<span class="w-8 text-right text-xs text-text-muted">{optionIndex + 1}</span>
			</div>
		{/each}
	</div>
	<!-- Outside the zone, so it can neither be dragged nor have an option dropped below it. -->
	{#if question.allowOther}
		<div class="flex items-center gap-2">
			<span class="w-6 shrink-0"></span>
			<p class="field min-w-0 border-dashed text-text-muted">その他…</p>
			<button
				type="button"
				class="chip p-1.5"
				aria-label="質問 {index + 1} の「その他」を削除"
				onclick={() => history.step(() => (question.allowOther = false))}
			>
				<Icon name="x" />
			</button>
			<span class="w-8"></span>
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			class="chip"
			onclick={() => history.step(() => (question.options = [...question.options, newOption()]))}
		>
			選択肢を追加
		</button>
		{#if !question.allowOther}
			<button
				type="button"
				class="chip"
				onclick={() => history.step(() => (question.allowOther = true))}
			>
				「その他」を追加
			</button>
		{/if}
	</div>
</div>
