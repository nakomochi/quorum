<script lang="ts" module>
	/** What each button does. The list also finds a button by it, to put focus back after a move. */
	export type ToolbarAction = 'add' | 'duplicate' | 'up' | 'down' | 'remove' | 'undo' | 'redo';
</script>

<script lang="ts">
	import Icon, { type IconName } from '$lib/icons/Icon.svelte';
	import type { HistoryControls } from './history.svelte';

	type Props = {
		/** The open question's place in the list, counted from 0. */
		index: number;
		/** How many questions the list holds. */
		count: number;
		/** False once the form holds as many questions as it may. */
		canAdd: boolean;
		history: HistoryControls;
		onaction: (action: ToolbarAction) => void;
	};

	let { index, count, canAdd, history, onaction }: Props = $props();

	type Button = {
		action: ToolbarAction;
		label: string;
		icon: IconName;
		disabled: boolean;
		/** Shown in the tooltip, as FormEditor handles it. */
		shortcut?: { text: string; aria: string };
	};

	// Split by a rule into adding, moving, deleting and history. A form keeps at least one question.
	const groups: Button[][] = $derived([
		[
			{ action: 'add', label: '質問を追加', icon: 'circle-plus', disabled: !canAdd },
			{ action: 'duplicate', label: 'この質問を複製', icon: 'copy', disabled: !canAdd }
		],
		[
			{ action: 'up', label: '上へ移動', icon: 'arrow-up', disabled: index === 0 },
			{ action: 'down', label: '下へ移動', icon: 'arrow-down', disabled: index === count - 1 }
		],
		[{ action: 'remove', label: 'この質問を削除', icon: 'trash-2', disabled: count === 1 }],
		[
			{
				action: 'undo',
				label: '元に戻す',
				icon: 'undo-2',
				disabled: !history.canUndo,
				shortcut: { text: 'Ctrl+Z', aria: 'Control+Z Meta+Z' }
			},
			{
				action: 'redo',
				label: 'やり直す',
				icon: 'redo-2',
				disabled: !history.canRedo,
				shortcut: { text: 'Ctrl+Y', aria: 'Control+Y Control+Shift+Z Meta+Shift+Z' }
			}
		]
	]);
</script>

<!-- A row along the card's bottom edge on a phone. From md the page leaves a gutter to the right
     of the cards, and the bar floats there instead: the outer box spans the card's height so that
     the bar can stay in view while a tall card scrolls past. -->
<div
	class="flex justify-end border-t border-border pt-2 md:absolute md:inset-y-0 md:left-full md:ml-3 md:block md:border-t-0 md:pt-0"
>
	<div
		role="group"
		aria-label="質問 {index + 1} の操作"
		data-question-toolbar
		class="flex items-center gap-0.5 md:sticky md:top-4 md:flex-col md:rounded-xl md:border md:border-border md:bg-surface md:p-1 md:shadow-sm"
	>
		{#each groups as group, groupIndex (groupIndex)}
			{#if groupIndex > 0}
				<span
					aria-hidden="true"
					class="mx-1 my-1.5 w-px self-stretch bg-border md:mx-1.5 md:my-1 md:h-px md:w-auto"
				></span>
			{/if}
			{#each group as button (button.action)}
				<!-- Slightly tighter on a phone, so that all seven fit one row at 375px. -->
				<button
					type="button"
					class={[
						'rounded-lg p-1.5 text-text-subtle transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent md:p-2',
						button.action === 'remove' && 'hover:text-danger disabled:hover:text-text-subtle'
					]}
					aria-label={button.label}
					title={button.shortcut ? `${button.label}（${button.shortcut.text}）` : button.label}
					aria-keyshortcuts={button.shortcut?.aria}
					data-toolbar-action={button.action}
					disabled={button.disabled}
					onclick={() => onaction(button.action)}
				>
					<Icon name={button.icon} class="size-5" />
				</button>
			{/each}
		{/each}
	</div>
</div>
