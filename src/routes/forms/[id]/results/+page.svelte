<script lang="ts">
	import AdminPanel from '$lib/components/AdminPanel.svelte';
	import ContextLink from '$lib/components/ContextLink.svelte';
	import MetaLine from '$lib/components/MetaLine.svelte';
	import { displayJst } from '$lib/display-date';
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

	const canAnnounce = $derived(!!data.announcement?.hasChannel && !data.announcement.url);
	const canRemind = $derived(!!data.announcement?.hasChannel && !data.closed);

	// An empty mirror has nothing to count. One that predates guild_sync still has people in it.
	const rosterMissing = $derived(
		data.manage && !data.frozen && data.rosterSyncedAt === null && data.targetCount === 0
	);

	// Shown in the managers' panel and again beside the non-submitters it was counted from.
	const rosterItem = $derived({
		label: '名簿',
		value: data.rosterSyncedAt ? `${displayJst(data.rosterSyncedAt)} 時点` : '未同期'
	});

	let syncingRoster = $state(false);

	function confirmReopen(event: SubmitEvent) {
		const message = data.reopenClearsClosesAt
			? '対象者と未提出者の確定を破棄して受付を再開します。受付終了日時を過ぎているため、その設定は解除され、以後は手動で締め切るまで回答を受け付けます。元に戻せません。'
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

<!-- A compact link shows only its icon on a phone, where the history table has no room for text. -->
{#snippet discordLink(url: string, label: string, compact: boolean)}
	<a
		href={url}
		target="_blank"
		rel="noopener noreferrer"
		class="inline-flex items-center gap-1 text-text-muted underline underline-offset-2 hover:text-text-subtle"
	>
		<span class={compact ? 'max-sm:sr-only' : ''}>{label}</span>
		<Icon name="external-link" class="size-3.5 shrink-0" />
	</a>
{/snippet}

{#snippet answerTable(rows: Row[])}
	<div class="table-wrap">
		<table class="data-table">
			<thead>
				<tr>
					<th class="whitespace-nowrap">回答者</th>
					{#each data.questions as q (q.id)}
						<th>{q.label}</th>
					{/each}
					<th class="whitespace-nowrap">提出日時</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.responseId)}
					<tr>
						<td class="font-medium whitespace-nowrap">{row.displayName}</td>
						{#each data.questions as q (q.id)}
							<td class="max-w-64 whitespace-pre-wrap text-text-subtle">
								{readable(row, q.id, q.options)}
							</td>
						{/each}
						<td class="text-xs whitespace-nowrap text-text-muted tabular-nums">
							{displayJst(row.submittedAt)}
							{#if row.revisionCount > 1}
								<!-- The date first and the mark after it, as everywhere else. -->
								<span class="mt-1.5 flex items-center gap-2">
									<span>更新 {displayJst(row.updatedAt)}</span>
									{#if data.manage}
										<a
											href="/forms/{data.form.id}/results/{row.responseId}"
											title="編集履歴を見る"
											class="chip py-0.5">編集済み</a
										>
									{:else}
										<span class="badge badge-muted">編集済み</span>
									{/if}
								</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

<!-- The POST is a full navigation; a page restored from the back-forward cache must not stay disabled. -->
<svelte:window onpageshow={() => (syncingRoster = false)} />

<main class="page-wide">
	<div class="flex flex-col gap-3">
		<!-- Not "back": the creator and admins usually arrive from the top page or the admin list. -->
		<ContextLink href="/forms/{data.form.id}" label="回答画面へ" direction="forward" />

		<header class="min-w-0">
			<h1 class="page-title">{data.form.title}</h1>
			<MetaLine
				class="mt-1.5"
				items={[
					{ label: '締切', value: displayJst(data.form.deadline, 'なし') },
					{ label: '受付終了', value: displayJst(data.form.closesAt, '指定なし') },
					...(data.manage && data.form.visibility
						? [{ label: '公開範囲', value: VISIBILITY_LABELS[data.form.visibility] }]
						: [])
				]}
			/>
		</header>
	</div>

	{#if data.roleDeleted}
		<p role="alert" class="alert-warning">
			対象ロールが Discord で削除されています。対象者は0名として扱われます。
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
			未提出者 {form.reminded.targets}名にリマインドを送信しました。{form.reminded.messages > 1
				? `（${form.reminded.messages}通に分けて送信）`
				: ''}
		</p>
	{:else if form?.announced}
		<p role="status" class="alert-success">告知を投稿しました。</p>
	{:else if form?.closed !== undefined}
		<p role="status" class="alert-success">
			{form.closed === 0
				? '締め切りました。未提出者はいません。'
				: `締め切りました。未提出者 ${form.closed}名を確定しました。`}
		</p>
	{:else if form?.reopened}
		<p role="status" class="alert-success">受付を再開しました。</p>
	{:else if form?.rosterSynced}
		<p role="status" class="alert-success">名簿を更新しました。</p>
	{/if}

	<section class="card divide-border grid grid-cols-3 divide-x">
		<div class="px-5 py-4">
			<p class="text-xs text-text-muted">対象者</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums">
				{rosterMissing ? '—' : data.targetCount}
			</p>
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
				{rosterMissing ? '—' : data.nonSubmitters.length}
			</p>
		</div>
	</section>

	<!-- Everything only the creator and admins may do, in one frame the members never see. Each
	     part reads heading, explanation, then its buttons, which sit to the right from `sm`. -->
	{#if data.manage && data.announcement}
		<AdminPanel class="flex flex-col gap-4 p-5">
			<div class="divide-border flex flex-col divide-y *:py-4 *:first:pt-0 *:last:pb-0">
				<section class="action-row">
					<div class="min-w-0 flex-1 text-sm">
						<h3 class="section-title">受付</h3>
						<p class="mt-1 text-text-muted">
							{#if data.form.closedAt}
								<span class="whitespace-nowrap">{displayJst(data.form.closedAt)}</span> に締め切りました。
							{:else}
								締め切ると、Discord から最新のメンバー一覧を取得して未提出者を確定し、以後の提出を受け付けません。受付はあとから再開できます。
							{/if}
						</p>
					</div>
					{#if data.form.closedAt}
						<form method="POST" action="?/reopen" onsubmit={confirmReopen} class="shrink-0">
							<button type="submit" class="btn-secondary px-4 py-2">受付を再開する</button>
						</form>
					{:else}
						<form method="POST" action="?/close" class="shrink-0">
							<button type="submit" class="btn-primary px-4 py-2">締め切って確定する</button>
						</form>
					{/if}
				</section>

				<section class="flex flex-col gap-3">
					<div class="action-row">
						<div class="min-w-0 flex-1 text-sm">
							<h3 class="section-title">Discord への告知とリマインド</h3>
							<p class="mt-1 text-text-muted">
								{#if !data.announcement.hasChannel}
									告知チャンネルが未設定のフォームです。告知の投稿もリマインドの送信もできません。
								{:else if data.closed}
									受付を終了したフォームのため、リマインドは送信できません。
								{:else if data.announcement.url}
									リマインドは告知メッセージへの返信として投稿し、未提出者を個別にメンションします。
								{:else}
									告知がまだ投稿されていません。リマインドは送信できますが、告知への返信にはなりません。
								{/if}
							</p>
							{#if data.announcement.url}
								<p class="mt-2 text-xs">
									{@render discordLink(data.announcement.url, '告知メッセージを Discord で開く', false)}
								</p>
							{/if}
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

					{#if data.reminders.length === 0}
						<p class="text-xs text-text-muted">リマインドの送信履歴はありません。</p>
					{:else}
						<!-- A table so that each column lines up across the rows; the counts align right. -->
						<table class="self-start text-xs text-text-muted">
							<caption class="sr-only">リマインドの送信履歴</caption>
							<thead class="text-left text-text-subtle">
								<tr>
									<th scope="col" class="pr-4 pb-1 font-medium">送信日時</th>
									<th scope="col" class="pr-4 pb-1 font-medium">種類</th>
									<th scope="col" class="pb-1 text-right font-medium">対象</th>
									<th scope="col" class="pb-1"><span class="sr-only">通数</span></th>
									<th scope="col" class="pb-1"><span class="sr-only">未送信</span></th>
									<th scope="col" class="pb-1"><span class="sr-only">メッセージ</span></th>
								</tr>
							</thead>
							<tbody class="tabular-nums">
								{#each data.reminders as entry (entry.id)}
									<tr>
										<td class="pr-4 py-0.5 whitespace-nowrap">{displayJst(entry.sentAt)}</td>
										<td class="pr-4 py-0.5 whitespace-nowrap">{REMINDER_KIND[entry.kind]}</td>
										<td class="py-0.5 text-right whitespace-nowrap">{entry.targetCount}名</td>
										<!-- A single message is the usual case and goes unsaid. -->
										<td class="py-0.5 whitespace-nowrap">
											{entry.messageCount > 1 ? `（${entry.messageCount}通）` : ''}
										</td>
										<!-- Left by a send that failed partway, until the next one of its kind continues it. -->
										<td class="py-0.5 pl-2 whitespace-nowrap text-warning">
											{entry.pendingCount > 0 ? `残り${entry.pendingCount}名は未送信` : ''}
										</td>
										<td class="py-0.5 pl-2 whitespace-nowrap">
											{#if entry.url}
												{@render discordLink(entry.url, 'Discord で開く', true)}
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</section>

				<!-- A frozen list no longer follows the roster, and the action refuses a refresh then. -->
				{#if !data.frozen}
					<section class="action-row">
						<div class="min-w-0 flex-1 text-sm">
							<h3 class="section-title">未提出者の名簿</h3>
							<p class="mt-1 text-text-muted">
								未提出者は、Discord のメンバー一覧を写した名簿から数えています。ロールを付け外ししたあとは更新してください。
							</p>
							<MetaLine class="mt-2" items={[rosterItem]} />
						</div>
						<form
							method="POST"
							action="?/syncRoster"
							onsubmit={() => (syncingRoster = true)}
							class="shrink-0"
						>
							<button type="submit" class="btn-secondary px-4 py-2" disabled={syncingRoster}>
								{syncingRoster ? '更新中…' : '名簿を更新'}
							</button>
						</form>
					</section>
				{/if}
			</div>
		</AdminPanel>
	{/if}

	{#if data.tallies.length > 0}
		<section class="flex flex-col gap-3">
			<h2 class="section-title">集計（回答者 {answerTotal}名）</h2>
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
		<h2 class="section-title">回答一覧（{data.submitted.length}名）</h2>
		{#if data.submitted.length === 0}
			<p class="text-sm text-text-muted">対象者からの回答はまだありません。</p>
		{:else}
			{@render answerTable(data.submitted)}
		{/if}
	</section>

	<section class="flex flex-col gap-2">
		<h2 class="section-title flex items-center gap-2">
			未提出者{rosterMissing ? '' : `（${data.nonSubmitters.length}名）`}
			{#if data.frozen}
				<span class="badge badge-muted">確定済み</span>
			{/if}
		</h2>
		<!-- The refresh itself sits in the managers' panel; the list says which roster it is from. -->
		{#if data.manage && !data.frozen}
			<MetaLine items={[rosterItem]} />
		{/if}
		{#if rosterMissing}
			<p class="alert-warning">
				名簿がまだ同期されていないため表示できません。上の管理パネルの「名簿を更新」を押してください。
			</p>
		{:else if data.nonSubmitters.length === 0}
			<p class="text-sm text-text-muted">未提出者はいません。</p>
		{:else}
			<ul class="card flex flex-wrap gap-2 p-4">
				{#each data.nonSubmitters as name, index (index)}
					<li class="border-border-strong rounded border px-2 py-1 text-xs text-text-subtle">
						{name}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if data.outsiders.length > 0}
		<section class="flex flex-col gap-2">
			<h2 class="section-title">
				対象外からの回答（{data.outsiders.length}名）
			</h2>
			<p class="text-xs text-text-muted">対象ロールを持たない人の回答です。未提出者には含みません。</p>
			{@render answerTable(data.outsiders)}
		</section>
	{/if}
</main>
