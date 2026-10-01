<script lang="ts">
	import type { ActionResult } from '@sveltejs/kit';
	import ContextLink from '$lib/components/ContextLink.svelte';
	import { displayJst } from '$lib/display-date';
	import FormEditor from '$lib/form-editor/FormEditor.svelte';

	let { data, form } = $props();

	const resultsHref = $derived(`/forms/${data.form.id}/results`);

	// Told by the load, or by a publish refused because someone else published first.
	const stale = $derived(!!data.editor?.stale || form?.reason === 'stale');

	let editor = $state<ReturnType<typeof FormEditor>>();

	// The notice sits under the heading, far from the button that was pressed.
	function onresult(result: ActionResult) {
		if (result.type === 'failure' && result.data?.reason === 'stale') window.scrollTo({ top: 0 });
	}
</script>

<!-- A plain post: the reload starts the editor afresh. Nothing more is saved meanwhile, so the
     draft it throws away cannot be written again behind it. -->
{#snippet reload(label: string)}
	<form
		method="POST"
		action="?/reload"
		onsubmit={() => editor?.stopSaving()}
		class="shrink-0 self-start sm:self-auto"
	>
		<button type="submit" class="btn-secondary btn-sm">{label}</button>
	</form>
{/snippet}

{#if data.editor}
	<FormEditor
		bind:this={editor}
		heading="フォームを編集"
		roles={data.editor.roles}
		channels={data.editor.channels}
		draft={data.editor.draft}
		{form}
		action="?/publish"
		submitLabel="変更を公開"
		locks={data.editor.locks}
		extraFields={{ baseVersion: String(data.editor.baseVersion) }}
		conflictMessage="別の画面でこの編集が更新されたか、公開・破棄されました。この画面の自動保存は停止しています。"
		{onresult}
	>
		{#snippet notices()}
			{#if stale}
				<div role="alert" class="alert-warning action-row">
					<p class="min-w-0 flex-1">
						ほかの人が先に変更を公開しました。最新の内容を読み込み直してください。この画面での変更は破棄されます。
					</p>
					{@render reload('最新の内容を読み込む')}
				</div>
			{:else if data.editor?.resumed}
				<div class="card action-row px-4 py-3">
					<p class="min-w-0 flex-1 text-sm text-text-subtle">
						前回の編集内容を復元しました
						<span class="whitespace-nowrap text-xs text-text-muted">
							（{displayJst(data.editor.draft.updatedAt)} に保存）
						</span>
					</p>
					{@render reload('破棄して最新の内容を読み込む')}
				</div>
			{/if}
		{/snippet}
		{#snippet actions()}
			<a href={resultsHref} class="text-sm text-text-muted hover:underline">キャンセル</a>
		{/snippet}
	</FormEditor>
{:else}
	<main class="page">
		<div class="flex flex-col gap-3">
			<ContextLink href={resultsHref} label="回答状況へ戻る" direction="back" />
			<header>
				<h1 class="page-title">フォームを編集</h1>
				<p class="mt-1 text-sm text-text-muted">{data.form.title}</p>
			</header>
		</div>
		<section class="card p-6">
			<h2 class="text-lg font-semibold">確定済みのため編集できません</h2>
			<p class="mt-1 text-sm text-text-muted">
				結果画面で受付を再開してから編集してください。
			</p>
		</section>
	</main>
{/if}
