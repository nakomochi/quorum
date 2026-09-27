<script lang="ts">
	import { formatJst } from '$lib/datetime';
	import { describeAnswer, VISIBILITY_LABELS, type AnswerValue } from '$lib/forms';
	import Icon from '$lib/icons/Icon.svelte';

	let { data, form } = $props();

	type Row = (typeof data.submitted)[number];
	type Option = { id: string; label: string };

	function readable(row: Row, questionId: number, options: Option[] | null): string {
		const value = row.answers[questionId] as AnswerValue | undefined;
		return value ? describeAnswer(value, options) : '—';
	}

	const REMINDER_KIND = { manual: '手動', auto: '自動' };

	const percent = (count: number, total: number) => (total === 0 ? 0 : (count / total) * 100);

	const answerTotal = $derived(data.submitted.length + data.outsiders.length);

	const canAnnounce = $derived(!!data.announcement?.channelId && !data.announcement.messageId);
	const canRemind = $derived(!!data.announcement?.channelId && !data.closed);

	function confirmReopen(event: SubmitEvent) {
		const message = data.reopenClearsClosesAt
			? '対象者と未提出者の確定を破棄して受付を再開します。受付終了日時を過ぎているため、その設定は解除され、以後は手動でクローズするまで回答を受け付けます。元に戻せません。'
			: '対象者と未提出者の確定を破棄して受付を再開します。元に戻せません。';
		if (!confirm(message)) event.preventDefault();
	}
</script>

{#snippet tallyRow(label: string, count: number)}
	<li class="flex items-center gap-3 text-sm">
		<span class="w-28 shrink-0 truncate text-text-subtle sm:w-40">{label}</span>
		<span class="bg-surface-raised h-2 flex-1 overflow-hidden rounded">
			<span class="bg-accent block h-full" style="width: {percent(count, answerTotal)}%"></span>
		</span>
		<span class="w-10 shrink-0 text-right tabular-nums text-text-muted">{count}</span>
	</li>
{/snippet}

{#snippet answerTable(rows: Row[])}
	<div class="overflow-x-auto rounded-xl border border-border">
		<table class="w-max min-w-full text-left text-sm">
			<thead class="bg-surface-alt text-xs text-text-muted">
				<tr>
					<th class="px-4 py-3 font-medium whitespace-nowrap">回答者</th>
					{#each data.questions as q (q.id)}
						<th class="px-4 py-3 font-medium">{q.label}</th>
					{/each}
					<th class="px-4 py-3 font-medium whitespace-nowrap">提出日時</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.discordId)}
					<tr class="border-t border-border">
						<td class="px-4 py-3 font-medium whitespace-nowrap">{row.displayName}</td>
						{#each data.questions as q (q.id)}
							<td class="max-w-64 px-4 py-3 whitespace-pre-wrap text-text-subtle">
								{readable(row, q.id, q.options)}
							</td>
						{/each}
						<td class="px-4 py-3 text-xs whitespace-nowrap text-text-muted">
							{formatJst(row.submittedAt)}
							{#if row.revisionCount > 1}
								<span class="mt-1.5 flex items-center gap-2">
									{#if data.manage}
										<a
											href="/forms/{data.form.id}/results/{row.responseId}"
											title="編集履歴を見る"
											class="chip py-0.5">編集済み</a
										>
									{:else}
										<span class="bg-surface-raised rounded px-2 py-0.5 text-text-subtle">編集済み</span>
									{/if}
									<span>最終更新: {formatJst(row.updatedAt)}</span>
								</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

<main class="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
	<header>
		<h1 class="text-xl font-semibold tracking-tight">{data.form.title}</h1>
		<p class="mt-1 text-sm text-text-muted">回答状況</p>
		<p class="mt-2 text-xs text-text-muted">
			<span class="whitespace-nowrap">締切: {formatJst(data.form.deadline, 'なし')}</span>
			<span class="whitespace-nowrap">/ 受付終了: {formatJst(data.form.closesAt, '指定なし')}</span>
			{#if data.manage}
				<span class="whitespace-nowrap">/ 公開範囲: {VISIBILITY_LABELS[data.form.visibility]}</span>
			{/if}
		</p>
	</header>

	{#if data.roleDeleted}
		<p role="alert" class="alert-warning">
			対象ロールが Discord で削除されています。対象者は0人として扱われます。
		</p>
	{/if}

	{#if data.announceFailed}
		<p role="alert" class="alert-error">
			フォームは作成しましたが、Discord への告知の投稿に失敗しました。下の「告知を投稿する」から再投稿できます。
		</p>
	{/if}

	{#if form?.message}
		<p role="alert" class="alert-error">{form.message}</p>
	{:else if form?.reminded}
		<p role="status" class="alert-success">
			リマインドを送信しました。未提出者 {form.reminded.targets}名を {form.reminded.messages}通に分けてメンションしました。
		</p>
	{:else if form?.announced}
		<p role="status" class="alert-success">告知を投稿しました。</p>
	{:else if form?.closed !== undefined}
		<p role="status" class="alert-success">
			クローズしました。未提出者 {form.closed}名を確定しました。
		</p>
	{:else if form?.reopened}
		<p role="status" class="alert-success">
			受付を再開しました。対象者と未提出者の確定は破棄されました。
		</p>
	{/if}

	<section class="card divide-border grid grid-cols-3 divide-x">
		<div class="px-5 py-4">
			<p class="text-xs text-text-muted">対象者</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums">{data.targetCount}</p>
		</div>
		<div class="px-5 py-4">
			<p class="text-xs text-text-muted">提出済み</p>
			<p class="mt-1 text-2xl font-semibold text-success tabular-nums">
				{data.submitted.length}
			</p>
		</div>
		<div class="px-5 py-4">
			<p class="text-xs text-text-muted">未提出</p>
			<p class="mt-1 text-2xl font-semibold text-warning tabular-nums">
				{data.nonSubmitters.length}
			</p>
		</div>
	</section>

	{#if data.manage}
		<section class="card action-row px-5 py-4">
			<p class="min-w-0 flex-1 text-sm text-text-subtle">
				{#if data.form.closedAt}
					<span class="whitespace-nowrap">{formatJst(data.form.closedAt)}</span> にクローズしました。対象者と未提出者は確定済みで、メンバー情報が更新されても変わりません。
				{:else}
					クローズすると Discord から最新のメンバー一覧を取得し、未提出者を確定して提出を締め切ります。
				{/if}
			</p>
			{#if data.form.closedAt}
				<form method="POST" action="?/reopen" onsubmit={confirmReopen} class="shrink-0">
					<button type="submit" class="btn-secondary px-4 py-2">受付を再開する</button>
				</form>
			{:else}
				<form method="POST" action="?/close" class="shrink-0">
					<button type="submit" class="btn-primary px-4 py-2">クローズして確定する</button>
				</form>
			{/if}
		</section>
	{/if}

	{#if data.manage && data.announcement}
		<section class="card flex flex-col gap-4 p-5">
			<div class="action-row">
				<div class="min-w-0 flex-1 text-sm">
					<h2 class="font-medium text-text-subtle">Discord への告知とリマインド</h2>
					<p class="mt-1 text-text-muted">
						{#if !data.announcement.channelId}
							告知チャンネルが未設定のフォームです。告知の投稿もリマインドの送信もできません。
						{:else if data.closed}
							受付を終了したフォームのため、リマインドは送信できません。
						{:else if data.announcement.messageId}
							リマインドは告知メッセージへの返信として投稿し、未提出者を個別にメンションします。
						{:else}
							告知がまだ投稿されていません。リマインドは送信できますが、告知への返信にはなりません。
						{/if}
					</p>
				</div>
				{#if canAnnounce || canRemind}
					<div class="flex shrink-0 flex-wrap gap-2">
						{#if canAnnounce}
							<form method="POST" action="?/announce">
								<button type="submit" class="btn-secondary px-4 py-2">告知を投稿する</button>
							</form>
						{/if}
						{#if canRemind}
							<form method="POST" action="?/remind">
								<button type="submit" class="btn-primary px-4 py-2">未提出者にリマインド</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>

			<div class="border-t border-border pt-3">
				{#if data.reminders.length === 0}
					<p class="text-xs text-text-muted">リマインドの送信履歴はありません。</p>
				{:else}
					<ul class="flex flex-col gap-1 text-xs text-text-muted">
						{#each data.reminders as entry (entry.id)}
							<li class="flex flex-wrap gap-x-3">
								<span class="whitespace-nowrap tabular-nums">送信 {formatJst(entry.sentAt)}</span>
								<span>{REMINDER_KIND[entry.kind]}</span>
								<span class="tabular-nums">{entry.targetCount}名 / {entry.messageCount}通</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>
	{/if}

	{#if data.tallies.length > 0}
		<section class="flex flex-col gap-3">
			<h2 class="text-sm font-medium text-text-subtle">集計（回答 {answerTotal}件）</h2>
			{#each data.tallies as tally (tally.questionId)}
				<div class="card p-5">
					<p class="text-sm font-medium">{tally.label}</p>
					<ul class="mt-3 flex flex-col gap-2">
						{#each tally.options as option (option.id)}
							{@render tallyRow(option.label, option.count)}
						{/each}
						{#if tally.other !== null}
							{@render tallyRow('その他', tally.other)}
						{/if}
					</ul>
				</div>
			{/each}
		</section>
	{/if}

	<section class="flex flex-col gap-2">
		<h2 class="text-sm font-medium text-text-subtle">回答一覧（{data.submitted.length}名）</h2>
		{#if data.submitted.length === 0}
			<p class="text-sm text-text-muted">対象者からの回答はまだありません。</p>
		{:else}
			{@render answerTable(data.submitted)}
		{/if}
	</section>

	<section class="flex flex-col gap-2">
		<h2 class="flex items-center gap-2 text-sm font-medium text-text-subtle">
			未提出者（{data.nonSubmitters.length}名）
			{#if data.frozen}
				<span class="bg-surface-raised rounded px-2 py-0.5 text-xs text-text-muted">確定済み</span>
			{/if}
		</h2>
		{#if data.nonSubmitters.length === 0}
			<p class="text-sm text-text-muted">未提出者はいません。</p>
		{:else}
			<ul class="card flex flex-wrap gap-2 p-4">
				{#each data.nonSubmitters as member (member.discordId)}
					<li class="border-border-strong rounded border px-2 py-1 text-xs text-text-subtle">
						{member.displayName}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if data.outsiders.length > 0}
		<section class="flex flex-col gap-2">
			<h2 class="text-sm font-medium text-text-subtle">
				対象外からの回答（{data.outsiders.length}名）
			</h2>
			<p class="text-xs text-text-muted">対象ロールを持たない人の回答です。未提出者には含みません。</p>
			{@render answerTable(data.outsiders)}
		</section>
	{/if}

	<div class="flex gap-4 text-sm text-text-muted">
		<a href="/forms/{data.form.id}" class="hover:underline">回答画面へ</a>
		<a href="/" class="inline-flex items-center gap-1.5 hover:underline">
			<Icon name="arrow-left" />
			トップへ
		</a>
	</div>
</main>
