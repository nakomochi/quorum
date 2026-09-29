<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatJstTime } from '$lib/datetime';
	import type { SaveStatus } from '$lib/draft-autosave';

	type Props = {
		status: SaveStatus;
		/** Before the time of the last save, e.g. 保存済み. */
		savedLabel: string;
		/** e.g. 保存できませんでした. */
		failedLabel: string;
		/** Appended to the failure when the payload was too large to save. */
		tooLargeHint: string;
		/** Why autosave stopped after a 409 conflict. */
		conflictMessage: string;
		/** Set once the page no longer takes input; shown in place of the conflict notice. */
		closedMessage?: string | null;
		/** The form's buttons, which the status line follows. */
		children: Snippet;
	};

	let {
		status,
		savedLabel,
		failedLabel,
		tooLargeHint,
		conflictMessage,
		closedMessage = null,
		children
	}: Props = $props();
</script>

<!-- No wrapper: the notice and the row are spaced by the form they sit in. -->
{#if closedMessage}
	<p role="alert" class="alert-warning">{closedMessage}</p>
{:else if status.kind === 'conflict'}
	<div role="alert" class="alert-warning action-row">
		<p class="min-w-0 flex-1">{conflictMessage}</p>
		<button
			type="button"
			class="btn-secondary btn-sm shrink-0 self-start sm:self-auto"
			onclick={() => location.reload()}
		>
			再読み込み
		</button>
	</div>
{/if}

<div class="flex flex-wrap items-center gap-x-4 gap-y-3">
	{@render children()}
	<p role="status" class="text-text-muted text-xs">
		{#if status.kind === 'saving'}
			保存中…
		{:else if status.kind === 'saved'}
			<span class="whitespace-nowrap">{savedLabel} {formatJstTime(status.at)}</span>
		{:else if status.kind === 'failed'}
			<span class="text-error-fg">
				{failedLabel}{status.tooLarge ? `。${tooLargeHint}` : ''}
			</span>
		{/if}
	</p>
</div>
