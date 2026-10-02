<script lang="ts">
	import MetaLine from '$lib/components/MetaLine.svelte';
	import { displayJst } from '$lib/display-date';
	import Icon from '$lib/icons/Icon.svelte';

	type Props = {
		/** The result of the submission just made: true when it created the response. */
		saved: boolean | undefined;
		submittedAt: Date | null;
		updatedAt: Date | null;
		closed: boolean;
		editable: boolean;
		/** Whether the answers may be opened for editing now. */
		canEdit: boolean;
		/** Answers saved as a draft and not sent are waiting. */
		unsent: boolean;
		discarding: boolean;
		onedit: () => void;
		/** Opens the unsent answers. */
		oncontinue: () => void;
		ondiscard: () => void;
	};

	let {
		saved,
		submittedAt,
		updatedAt,
		closed,
		editable,
		canEdit,
		unsent,
		discarding,
		onedit,
		oncontinue,
		ondiscard
	}: Props = $props();

	const heading = $derived(
		saved === true ? '回答を送信しました' : saved === false ? '回答を更新しました' : '回答済みです'
	);

	// Minute precision: an edit within the same minute as the submission adds nothing to show.
	const updated = $derived(
		updatedAt && displayJst(updatedAt) !== displayJst(submittedAt) ? displayJst(updatedAt) : null
	);
</script>

<section class="card flex flex-col gap-4 p-6">
	<div class="action-row">
		<div class="flex min-w-0 flex-1 items-start gap-3">
			<span class="shrink-0 rounded-full bg-success-badge p-1.5 text-success">
				<Icon name="check" />
			</span>
			<div class="min-w-0">
				<h2 class="text-lg font-semibold">{heading}</h2>
				<MetaLine
					class="mt-1"
					items={[
						{ label: '提出', value: displayJst(submittedAt) },
						...(updated ? [{ label: '更新', value: updated }] : [])
					]}
				/>
				{#if closed}
					<p class="mt-2 text-sm text-text-subtle">受付は終了しています。</p>
				{:else if !editable}
					<p class="mt-2 text-sm text-text-subtle">
						このフォームは回答の編集が許可されていません。
					</p>
				{/if}
			</div>
		</div>
		{#if canEdit && !unsent}
			<button
				type="button"
				class="btn-secondary inline-flex shrink-0 items-center gap-1.5 self-start px-4 py-2 sm:self-auto"
				onclick={onedit}
			>
				<Icon name="pencil" />
				回答を編集
			</button>
		{/if}
	</div>

	{#if canEdit && unsent}
		<div class="alert-warning action-row">
			<p class="min-w-0 flex-1">未送信の変更があります。</p>
			<div class="flex shrink-0 flex-wrap gap-2">
				<button
					type="button"
					class="btn-primary inline-flex items-center gap-1.5 px-4 py-2"
					onclick={oncontinue}
				>
					<Icon name="pencil" />
					続きを編集
				</button>
				<button
					type="button"
					class="btn-secondary px-4 py-2"
					disabled={discarding}
					onclick={ondiscard}
				>
					破棄
				</button>
			</div>
		</div>
	{/if}
</section>
