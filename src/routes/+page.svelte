<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import CreatedFormItem from '$lib/components/CreatedFormItem.svelte';
	import { deadlineItem, UNDER_ICON } from '$lib/components/form-rows';
	import ItemHeader from '$lib/components/ItemHeader.svelte';
	import MetaLine from '$lib/components/MetaLine.svelte';
	import RowMenu from '$lib/components/RowMenu.svelte';
	import SubmittedFormItem from '$lib/components/SubmittedFormItem.svelte';
	import { displayJst } from '$lib/display-date';
	import Icon from '$lib/icons/Icon.svelte';

	let { data } = $props();

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
</script>

<!-- The load sends the newest few; the rest are on the list's own page. -->
{#snippet seeAll(href: ResolvedPathname, total: number, shown: number)}
	{#if total > shown}
		<a
			{href}
			class="mt-2 inline-block text-xs text-text-muted hover:text-text-subtle hover:underline"
		>
			すべて見る（{total}件）
		</a>
	{/if}
{/snippet}

<!-- Signed in, the shared header sits above; signed out there is none, and the login is centred. -->
<main class="page {data.user ? '' : 'min-h-screen justify-center py-10'}">
	{#if data.user}
		{#if !data.member}
			<p class="card p-5 text-sm text-text-muted">
				対象の Discord サーバーのメンバーではないため、フォームは表示されません。
			</p>
		{:else}
			<section>
				<h2 class="text-base font-semibold text-text">
					未提出{data.pending.length > 0 ? ` ${data.pending.length}件` : ''}
				</h2>
				{#if data.pending.length === 0}
					<div class="card mt-3 flex flex-col items-center gap-2 p-6 text-center">
						<Icon name="check" class="size-6 text-success" />
						<p class="text-sm text-text-subtle">すべて提出済みです</p>
					</div>
				{:else}
					<ul class="mt-3 flex flex-col gap-2">
						{#each data.pending as row (row.id)}
							{@const level = urgency(row.deadline)}
							<li
								class="card border-l-2 {level === 'overdue'
									? 'border-l-danger'
									: 'border-l-accent'}"
							>
								<a
									href={resolve('/forms/[id]', { id: row.id })}
									class="flex flex-col gap-1 px-5 py-4"
								>
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
						提出済みのフォーム {data.submittedTotal}件
					</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.submitted as row (row.id)}
							<SubmittedFormItem {row} />
						{/each}
					</ul>
					{@render seeAll(resolve('/forms/submitted'), data.submittedTotal, data.submitted.length)}
				</section>
			{/if}

			{#if data.drafts.length > 0}
				<section>
					<h2 class="section-title">下書き {data.drafts.length}件</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.drafts as row (row.id)}
							<li class="card flex items-center gap-2 pr-3">
								<a
									href="{resolve('/forms/new')}?draft={row.id}"
									class="flex min-w-0 flex-1 flex-col gap-1 py-4 pl-5"
								>
									<ItemHeader
										title={row.title ?? '無題のフォーム'}
										titleClass={row.title ? 'font-medium' : 'text-text-muted'}
									>
										{#snippet icon()}
											<Icon name="pencil" class="size-4 shrink-0 text-text-muted" />
										{/snippet}
									</ItemHeader>
									<MetaLine
										class={UNDER_ICON}
										items={[{ label: '更新', value: displayJst(row.updatedAt) }]}
									/>
								</a>
								<RowMenu
									label="「{row.title ?? '無題のフォーム'}」の下書きの操作"
									items={[
										{
											kind: 'post',
											label: '破棄',
											action: '?/discardDraft',
											fields: { id: row.id },
											confirm: 'この下書きを削除します',
											enhance: true,
											danger: true
										}
									]}
								/>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if data.created.length > 0}
				<section>
					<h2 class="section-title">
						自分が作成したフォーム {data.createdTotal}件
					</h2>
					<ul class="mt-2 flex flex-col gap-2">
						{#each data.created as row (row.id)}
							<CreatedFormItem {row} />
						{/each}
					</ul>
					{@render seeAll(resolve('/forms/created'), data.createdTotal, data.created.length)}
				</section>
			{/if}
		{/if}
	{:else}
		<header>
			<h1 class="page-title text-2xl">Quorum</h1>
			<p class="mt-1 text-sm text-text-muted">Discord 認証つきフォーム / 出欠管理</p>
		</header>

		<form method="POST" action="?/login">
			<button type="submit" class="btn-primary w-full px-4 py-3"> Discord でログイン </button>
		</form>
	{/if}
</main>
