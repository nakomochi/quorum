<script lang="ts">
	import { formatJst } from '$lib/datetime';
	import { VISIBILITY_LABELS, type AnswerValue } from '$lib/forms';

	let { data, form } = $props();

	type Row = (typeof data.submitted)[number];
	type Option = { id: string; label: string };

	function readable(row: Row, questionId: number, options: Option[] | null): string {
		const value = row.answers[questionId] as AnswerValue | undefined;
		if (!value) return '—';
		const labelOf = (id: string) => options?.find((option) => option.id === id)?.label ?? id;
		switch (value.type) {
			case 'single':
				return labelOf(value.optionId);
			case 'multi':
				return value.optionIds.map(labelOf).join('、');
			case 'text':
				return value.text;
			case 'date':
				return value.date;
		}
	}

	const REMINDER_KIND = { manual: '手動', auto: '自動' };

	const percent = (count: number, total: number) => (total === 0 ? 0 : (count / total) * 100);

	const answerTotal = $derived(data.submitted.length + data.outsiders.length);

	function confirmReopen(event: SubmitEvent) {
		const ok = confirm('確定済みの未提出者リストを破棄して受付を再開します。元に戻せません。');
		if (!ok) event.preventDefault();
	}
</script>

<main class="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
	<header>
		<h1 class="text-xl font-semibold tracking-tight">{data.form.title}</h1>
		<p class="mt-1 text-sm text-slate-400">回答状況</p>
		<p class="mt-2 text-xs text-slate-500">
			締切: {formatJst(data.form.deadline)} / 受付終了: {formatJst(data.form.closesAt)}
			{#if data.manage}
				/ 公開範囲: {VISIBILITY_LABELS[data.form.visibility]}
			{/if}
		</p>
	</header>

	{#if data.announceFailed}
		<p class="alert-error">
			フォームは作成しましたが、Discord への告知の投稿に失敗しました。下の「告知を投稿する」から再投稿できます。
		</p>
	{/if}

	{#if form?.message}
		<p class="alert-error">{form.message}</p>
	{:else if form?.reminded}
		<p class="rounded-lg border border-emerald-900 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
			リマインドを送信しました。未提出者 {form.reminded.targets}名を {form.reminded.messages}通に分けてメンションしました。
		</p>
	{:else if form?.announced}
		<p class="rounded-lg border border-emerald-900 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
			告知を投稿しました。
		</p>
	{:else if form?.closed !== undefined}
		<p class="rounded-lg border border-emerald-900 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
			クローズしました。未提出者 {form.closed}名を確定しました。
		</p>
	{:else if form?.reopened}
		<p class="rounded-lg border border-emerald-900 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
			受付を再開しました。確定済みの未提出者リストは破棄されました。
		</p>
	{/if}

	<section class="card grid grid-cols-3 divide-x divide-slate-800">
		<div class="px-5 py-4">
			<p class="text-xs text-slate-400">対象者</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums">{data.targetCount}</p>
		</div>
		<div class="px-5 py-4">
			<p class="text-xs text-slate-400">提出済み</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums text-emerald-300">
				{data.submitted.length}
			</p>
		</div>
		<div class="px-5 py-4">
			<p class="text-xs text-slate-400">未提出</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums text-amber-300">
				{data.nonSubmitters.length}
			</p>
		</div>
	</section>

	{#if data.manage}
		<section class="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
			<p class="text-sm text-slate-300">
				{#if data.form.closedAt}
					{formatJst(data.form.closedAt)} にクローズしました。未提出者リストは確定済みで、
					メンバー情報が更新されても変わりません。
				{:else}
					クローズすると Discord から最新のメンバー一覧を取得し、未提出者を確定して提出を締め切ります。
				{/if}
			</p>
			{#if data.form.closedAt}
				<form method="POST" action="?/reopen" onsubmit={confirmReopen}>
					<button type="submit" class="chip px-3 py-1.5 text-sm">受付を再開する</button>
				</form>
			{:else}
				<form method="POST" action="?/close">
					<button type="submit" class="btn-primary px-4 py-2">クローズして確定する</button>
				</form>
			{/if}
		</section>
	{/if}

	{#if data.manage && data.announcement}
		<section class="card flex flex-col gap-4 p-5">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="text-sm">
					<h2 class="font-medium text-slate-300">Discord への告知とリマインド</h2>
					<p class="mt-1 text-slate-400">
						{#if !data.announcement.channelId}
							告知チャンネルが未設定のフォームです。告知の投稿もリマインドの送信もできません。
						{:else if data.announcement.messageId}
							リマインドは告知メッセージへの返信として投稿し、未提出者を個別にメンションします。
						{:else}
							告知がまだ投稿されていません。リマインドは送信できますが、告知への返信にはなりません。
						{/if}
					</p>
				</div>
				{#if data.announcement.channelId}
					<div class="flex gap-2">
						{#if !data.announcement.messageId}
							<form method="POST" action="?/announce">
								<button type="submit" class="chip px-3 py-1.5 text-sm">告知を投稿する</button>
							</form>
						{/if}
						<form method="POST" action="?/remind">
							<button type="submit" class="btn-primary px-4 py-2">未提出者にリマインド</button>
						</form>
					</div>
				{/if}
			</div>

			<div class="border-t border-slate-800 pt-3">
				{#if data.reminders.length === 0}
					<p class="text-xs text-slate-500">リマインドの送信履歴はありません。</p>
				{:else}
					<ul class="flex flex-col gap-1 text-xs text-slate-400">
						{#each data.reminders as entry (entry.id)}
							<li class="flex gap-3">
								<span class="tabular-nums">{formatJst(entry.sentAt)}</span>
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
			<h2 class="text-sm font-medium text-slate-300">集計（回答 {answerTotal}件）</h2>
			{#each data.tallies as tally (tally.questionId)}
				<div class="card p-5">
					<p class="text-sm font-medium">{tally.label}</p>
					<ul class="mt-3 flex flex-col gap-2">
						{#each tally.options as option (option.id)}
							<li class="flex items-center gap-3 text-sm">
								<span class="w-40 shrink-0 truncate text-slate-300">{option.label}</span>
								<span class="h-2 flex-1 overflow-hidden rounded bg-slate-800">
									<span
										class="bg-discord block h-full"
										style="width: {percent(option.count, answerTotal)}%"
									></span>
								</span>
								<span class="w-10 shrink-0 text-right tabular-nums text-slate-400">
									{option.count}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</section>
	{/if}

	<section class="flex flex-col gap-2">
		<h2 class="text-sm font-medium text-slate-300">回答一覧（{data.submitted.length}名）</h2>
		{#if data.submitted.length === 0}
			<p class="text-sm text-slate-500">対象者からの回答はまだありません。</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-slate-800">
				<table class="w-max min-w-full text-left text-sm">
					<thead class="bg-slate-900/80 text-xs text-slate-400">
						<tr>
							<th class="px-4 py-3 font-medium whitespace-nowrap">回答者</th>
							{#each data.questions as q (q.id)}
								<th class="px-4 py-3 font-medium">{q.label}</th>
							{/each}
							<th class="px-4 py-3 font-medium whitespace-nowrap">提出日時</th>
						</tr>
					</thead>
					<tbody>
						{#each data.submitted as row (row.discordId)}
							<tr class="border-t border-slate-800">
								<td class="px-4 py-3 font-medium whitespace-nowrap">{row.displayName}</td>
								{#each data.questions as q (q.id)}
									<td class="max-w-64 px-4 py-3 whitespace-pre-wrap text-slate-300">
										{readable(row, q.id, q.options)}
									</td>
								{/each}
								<td class="px-4 py-3 text-xs whitespace-nowrap text-slate-500">
									{formatJst(row.submittedAt)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="flex flex-col gap-2">
		<h2 class="flex items-center gap-2 text-sm font-medium text-slate-300">
			未提出者（{data.nonSubmitters.length}名）
			{#if data.frozen}
				<span class="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">確定済み</span>
			{/if}
		</h2>
		{#if data.nonSubmitters.length === 0}
			<p class="text-sm text-slate-500">未提出者はいません。</p>
		{:else}
			<ul class="card flex flex-wrap gap-2 p-4">
				{#each data.nonSubmitters as member (member.discordId)}
					<li class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300">
						{member.displayName}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if data.outsiders.length > 0}
		<section class="flex flex-col gap-2">
			<h2 class="text-sm font-medium text-slate-300">
				対象外からの回答（{data.outsiders.length}名）
			</h2>
			<p class="text-xs text-slate-500">対象ロールを持たない人の回答です。未提出者には含みません。</p>
			<div class="overflow-x-auto rounded-xl border border-slate-800">
				<table class="w-max min-w-full text-left text-sm">
					<thead class="bg-slate-900/80 text-xs text-slate-400">
						<tr>
							<th class="px-4 py-3 font-medium whitespace-nowrap">回答者</th>
							{#each data.questions as q (q.id)}
								<th class="px-4 py-3 font-medium">{q.label}</th>
							{/each}
							<th class="px-4 py-3 font-medium whitespace-nowrap">提出日時</th>
						</tr>
					</thead>
					<tbody>
						{#each data.outsiders as row (row.discordId)}
							<tr class="border-t border-slate-800">
								<td class="px-4 py-3 font-medium whitespace-nowrap">{row.displayName}</td>
								{#each data.questions as q (q.id)}
									<td class="max-w-64 px-4 py-3 whitespace-pre-wrap text-slate-300">
										{readable(row, q.id, q.options)}
									</td>
								{/each}
								<td class="px-4 py-3 text-xs whitespace-nowrap text-slate-500">
									{formatJst(row.submittedAt)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<div class="flex gap-4 text-sm text-slate-400">
		<a href="/forms/{data.form.id}" class="hover:underline">回答画面へ</a>
		<a href="/" class="hover:underline">← トップへ</a>
	</div>
</main>
