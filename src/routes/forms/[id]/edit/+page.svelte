<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ContextLink from '$lib/components/ContextLink.svelte';
	import { displayJst } from '$lib/display-date';
	import FormEditor from '$lib/form-editor/FormEditor.svelte';
	import { REOPEN_CLEARS_CLOSES_AT, reopenConfirmation } from '$lib/forms';
	import { toast } from '$lib/toast.svelte';

	let { data, form } = $props();

	const resultsHref = $derived(resolve('/forms/[id]/results', { id: data.form.id }));

	// Told by the load, or by a save refused because someone else saved first.
	const stale = $derived(!!data.editor?.stale || form?.reason === 'stale');

	// Once per visit, as on the results page: the query goes once it has been said.
	onMount(() => {
		if (!untrack(() => data.reopened)) return;
		toast.success('受付を再開しました。');
		if (!page.url.searchParams.has('reopened')) return;
		const timer = setTimeout(() => {
			const url = new URL(page.url);
			url.searchParams.delete('reopened');
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- a copy of page.url, already resolved; only its query changes
			replaceState(url, page.state);
		});
		return () => clearTimeout(timer);
	});

	function confirmReopen(event: SubmitEvent) {
		const roster = data.closed ? data.roster : true;
		if (!confirm(reopenConfirmation(data.reopenClearsClosesAt, roster))) event.preventDefault();
	}

	let editor = $state<ReturnType<typeof FormEditor>>();

	// Kept here, so that the box keeps its choice while a deadline typed back and forth hides it.
	let notifyDeadline = $state(true);

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

<!-- Only while the deadline differs from the published one, so the box is posted only then. -->
{#snippet deadlineReply(deadline: string)}
	{@const reply = data.editor?.deadlineReply}
	{#if reply && deadline !== reply.from}
		<div class="mt-2">
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="notifyDeadline"
					bind:checked={notifyDeadline}
					aria-describedby="notify-deadline-hint"
					class="size-4"
				/>
				締切の変更を Discord で知らせる
			</label>
			<span id="notify-deadline-hint" class="mt-1 block pl-6 text-xs text-text-muted">
				告知への返信として投稿します（メンションなし）。
			</span>
		</div>
	{/if}
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
		submitLabel="変更を保存"
		locks={data.editor.locks}
		extraFields={{ baseVersion: String(data.editor.baseVersion) }}
		conflictMessage="別の画面でこの編集が更新されたか、保存・破棄されました。この画面の自動保存は停止しています。"
		{onresult}
		afterDeadline={deadlineReply}
		back={{ href: resultsHref, label: '回答状況へ戻る' }}
	>
		{#snippet notices()}
			{#if stale}
				<div role="alert" class="alert-warning action-row">
					<p class="min-w-0 flex-1">
						ほかの人が先に変更を保存しました。最新の内容を読み込み直してください。この画面での変更は破棄されます。
					</p>
					{@render reload('最新の内容を読み込む')}
				</div>
			{:else if data.editor?.resumed}
				<div class="card action-row px-4 py-3">
					<p class="min-w-0 flex-1 text-sm text-text-subtle">
						前回の編集内容を復元しました
						<span class="text-xs whitespace-nowrap text-text-muted">
							（{displayJst(data.editor.draft.updatedAt)} に保存）
						</span>
					</p>
					{@render reload('破棄して最新の内容を読み込む')}
				</div>
			{/if}
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
		<!-- A plain post: the reopen redirects back here, and the load then opens the editor. -->
		<section class="card flex flex-col gap-4 p-6">
			<div>
				<h2 class="text-lg font-semibold">フォームを閉じているため編集できません</h2>
				<p class="mt-1 text-sm text-text-muted">受付を再開すると、ここで編集できます。</p>
				{#if data.reopenClearsClosesAt}
					<p class="mt-2 text-sm text-warning">{REOPEN_CLEARS_CLOSES_AT}</p>
				{/if}
			</div>
			<form method="POST" action="?/reopen" onsubmit={confirmReopen} class="self-start">
				<button type="submit" class="btn-secondary px-4 py-2">受付を再開</button>
			</form>
		</section>
	</main>
{/if}
