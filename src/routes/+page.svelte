<script lang="ts">
	import ItemHeader from '$lib/components/ItemHeader.svelte';
	import Menu, { type MenuItem } from '$lib/components/Menu.svelte';
	import MetaLine, { type MetaItem } from '$lib/components/MetaLine.svelte';
	import { displayJst } from '$lib/display-date';
	import { FORM_STATUS_LABELS, type FormStatus } from '$lib/forms';
	import Icon, { type IconName } from '$lib/icons/Icon.svelte';

	let { data } = $props();

	const deadlineItem = (value: Date | null): MetaItem =>
		value ? { label: '締切', value: displayJst(value) } : { value: '締切なし' };

	const SOON_MS = 48 * 60 * 60 * 1000;

	/**
	 * Read once per render, not per row. Two coarse buckets keep SSR and hydration in agreement;
	 * a relative "あと3時間" string would not, and would warn on every load.
	 *
	 * Deliberately `deadline`, not `closesAt`: a form past its deadline but still open is exactly
	 * the one to flag red, because it can — and should — still be answered right now.
	 */
	const now = Date.now();

	const urgency = (deadline: Date | null): 'overdue' | 'soon' | null => {
		if (!deadline) return null;
		const remaining = deadline.getTime() - now;
		if (remaining < 0) return 'overdue';
		return remaining <= SOON_MS ? 'soon' : null;
	};

	const STATUS_ICONS: Record<FormStatus, { name: IconName; tone: string }> = {
		open: { name: 'clock', tone: 'text-accent' },
		ended: { name: 'hourglass', tone: 'text-warning' },
		closed: { name: 'lock', tone: 'text-text-muted' }
	};

	/** Lines the details up with the title in lists whose rows lead with a size-4 icon and gap-2. */
	const UNDER_ICON = 'pl-6';

	// These two only ever grow; show a window of them until asked for the rest.
	const PREVIEW = 3;

	let allSubmitted = $state(false);
	let allCreated = $state(false);

	const submitted = $derived(allSubmitted ? data.submitted : data.submitted.slice(0, PREVIEW));
	const created = $derived(allCreated ? data.created : data.created.slice(0, PREVIEW));
</script>

{#snippet rowMenu(label: string, items: MenuItem[])}
	<Menu
		{label}
		{items}
		triggerClass="text-text-muted hover:bg-surface-raised hover:text-text-subtle focus-visible:ring-accent/60 rounded-lg p-2 outline-none focus-visible:ring-2"
	>
		{#snippet trigger()}
			<Icon name="ellipsis" />
		{/snippet}
	</Menu>
{/snippet}

<!-- Signed in, the shared header sits above; signed out there is none, and the login is centred. -->
<main class="page {data.user ? '' : 'min-h-screen justify-center py-10'}">
	{#if data.user}
		{#if !data.member}
			<p class="card text-text-muted p-5 text-sm">
				対象の Discord サーバーのメンバーではないため、フォームは表示されません。
			</p>
		{:else}
			<section>
				<h2 class="text-text text-base font-semibold">
					未提出{data.pending.length > 0 ? ` ${data.pending.length}件` : ''}
				</h2>
				{#if data.pending.length === 0}
					<div class="card mt-3 flex flex-col items-center gap-2 p-6 text-center">
						<Icon name="check" class="text-success size-6" />
						<p class="text-text-subtle text-sm">すべて提出済みです</p>
					</div>
				{:else}
					<ul class="mt-3 flex flex-col gap-2">
						{#each data.pending as row (row.id)}
							{@const level = urgency(row.deadline)}
							<li
								class="card border-l-2 {level === 'overdue' ? 'border-l-danger' : 'border-l-accent'}"
							>
								<a href="/forms/{row.id}" class="flex flex-col gap-1 px-5 py-4">
									<ItemHeader title={row.title}>
										{#snippet badges()}
											{#if level === 'overdue'}
												<span class="badge badge-danger">期限切れ</span>
											{:else if level === 'soon'}
												<span class="badge badge-warning">締切間近</span>
											{/if}
										{/snippet}
									</ItemHeader>
									<MetaLine items={[deadlineItem(row.deadline)]} />
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if data.submitted.length > 0}
				<section>
					<h2 class="section-title">
						提出済みのフォーム {data.submitted.length}件
					</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each submitted as row (row.id)}
							<li class="card">
								<a href="/forms/{row.id}" class="flex flex-col gap-1 px-5 py-4">
									<ItemHeader title={row.title} titleClass="text-text-subtle">
										{#snippet icon()}
											<Icon name="check" class="text-success size-4 shrink-0" />
										{/snippet}
										{#snippet badges()}
											{#if row.revisionCount > 1}
												<span class="badge badge-muted">編集済み</span>
											{/if}
										{/snippet}
									</ItemHeader>
									<MetaLine
										class={UNDER_ICON}
										items={[{ label: '提出', value: displayJst(row.submittedAt) }]}
									/>
								</a>
							</li>
						{/each}
					</ul>
					{#if data.submitted.length > PREVIEW}
						<button
							type="button"
							class="text-text-muted hover:text-text-subtle mt-2 text-xs hover:underline"
							onclick={() => (allSubmitted = !allSubmitted)}
						>
							{allSubmitted ? '一部だけ表示' : `すべて表示（${data.submitted.length}件）`}
						</button>
					{/if}
				</section>
			{/if}

			{#if data.drafts.length > 0}
				<section>
					<h2 class="section-title">下書き {data.drafts.length}件</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.drafts as row (row.id)}
							<li class="card flex items-center gap-2 pr-3">
								<a
									href="/forms/new?draft={row.id}"
									class="flex min-w-0 flex-1 flex-col gap-1 py-4 pl-5"
								>
									<ItemHeader
										title={row.title ?? '無題のフォーム'}
										titleClass={row.title ? 'font-medium' : 'text-text-muted'}
									>
										{#snippet icon()}
											<Icon name="pencil" class="text-text-muted size-4 shrink-0" />
										{/snippet}
									</ItemHeader>
									<MetaLine
										class={UNDER_ICON}
										items={[{ label: '更新', value: displayJst(row.updatedAt) }]}
									/>
								</a>
								{@render rowMenu(`「${row.title ?? '無題のフォーム'}」の下書きの操作`, [
									{
										kind: 'post',
										label: '破棄',
										action: '?/discardDraft',
										fields: { id: row.id },
										confirm: 'この下書きを削除します',
										enhance: true,
										danger: true
									}
								])}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if data.created.length > 0}
				<section>
					<h2 class="section-title">
						自分が作成したフォーム {data.created.length}件
					</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each created as row (row.id)}
							{@const status = STATUS_ICONS[row.status]}
							<li class="card flex items-center gap-2 pr-3">
								<a
									href="/forms/{row.id}/results"
									class="flex min-w-0 flex-1 flex-col gap-1 py-4 pl-5"
								>
									<ItemHeader title={row.title}>
										{#snippet icon()}
											<!-- The icon's shape and label carry the status, so no text badge repeats it. -->
											<span
												role="img"
												aria-label={FORM_STATUS_LABELS[row.status]}
												title={FORM_STATUS_LABELS[row.status]}
												class="flex shrink-0"
											>
												<Icon name={status.name} class="{status.tone} size-4" />
											</span>
										{/snippet}
									</ItemHeader>
									<MetaLine
										class={UNDER_ICON}
										items={[deadlineItem(row.deadline), { label: '回答', value: `${row.responseCount}名` }]}
									/>
								</a>
								<!-- The results page's own action: it redirects to the new draft. -->
								{@render rowMenu(`「${row.title}」の操作`, [
									{ kind: 'post', label: '複製', action: `/forms/${row.id}/results?/duplicate` }
								])}
							</li>
						{/each}
					</ul>
					{#if data.created.length > PREVIEW}
						<button
							type="button"
							class="text-text-muted hover:text-text-subtle mt-2 text-xs hover:underline"
							onclick={() => (allCreated = !allCreated)}
						>
							{allCreated ? '一部だけ表示' : `すべて表示（${data.created.length}件）`}
						</button>
					{/if}
				</section>
			{/if}
		{/if}
	{:else}
		<header>
			<h1 class="page-title text-2xl">Quorum</h1>
			<p class="text-text-muted mt-1 text-sm">Discord 認証つきフォーム / 出欠管理</p>
		</header>

		<form method="POST" action="?/login">
			<button type="submit" class="btn-primary w-full px-4 py-3"> Discord でログイン </button>
		</form>
	{/if}
</main>
