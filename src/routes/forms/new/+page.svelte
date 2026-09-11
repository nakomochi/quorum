<script lang="ts">
	import { nanoid } from 'nanoid';
	import { enhance } from '$app/forms';
	import {
		hasOptions,
		MAX_DESCRIPTION,
		MAX_HELP_TEXT,
		MAX_LABEL,
		MAX_OPTION_LABEL,
		MAX_TITLE,
		QUESTION_TYPE_LABELS,
		QUESTION_TYPES,
		type QuestionType
	} from '$lib/forms';

	type Draft = {
		key: string;
		type: QuestionType;
		label: string;
		helpText: string;
		required: boolean;
		options: { id: string; label: string }[];
	};

	let { data, form } = $props();

	const newOption = () => ({ id: nanoid(10), label: '' });

	function newQuestion(): Draft {
		return {
			key: nanoid(8),
			type: 'single',
			label: '',
			helpText: '',
			required: true,
			options: [newOption()]
		};
	}

	let questions = $state<Draft[]>([newQuestion()]);
	let deadline = $state('');
	let closesAt = $state('');
	// closesAt defaults to the announced deadline until the admin types their own value.
	let closesAtTouched = $state(false);

	const payload = $derived(
		JSON.stringify(
			questions.map((q) => ({
				type: q.type,
				label: q.label,
				helpText: q.helpText,
				required: q.required,
				options: hasOptions(q.type) ? q.options : null
			}))
		)
	);

	function onDeadlineInput(value: string) {
		deadline = value;
		if (!closesAtTouched) closesAt = value;
	}

	function move(index: number, delta: number) {
		const to = index + delta;
		if (to < 0 || to >= questions.length) return;
		const next = [...questions];
		[next[index], next[to]] = [next[to], next[index]];
		questions = next;
	}

	function onTypeChange(q: Draft, type: QuestionType) {
		q.type = type;
		if (hasOptions(type) && q.options.length === 0) q.options = [newOption()];
	}
</script>

<main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
	<header>
		<h1 class="text-xl font-semibold tracking-tight">フォームを作成</h1>
	</header>

	{#if form?.message}
		<p role="alert" class="alert-error">
			{form.message}
		</p>
	{/if}

	<!-- use:enhance keeps the question editor's state when the server answers with fail(). -->
	<form method="POST" use:enhance class="flex flex-col gap-6">
		<input type="hidden" name="questions" value={payload} />

		<section class="card flex flex-col gap-4 p-5">
			<label class="block">
				<span class="text-sm font-medium">タイトル</span>
				<input name="title" required maxlength={MAX_TITLE} class="field mt-1" />
			</label>

			<label class="block">
				<span class="text-sm font-medium">説明</span>
				<textarea
					name="description"
					rows="3"
					maxlength={MAX_DESCRIPTION}
					class="field mt-1"
				></textarea>
			</label>

			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="text-sm font-medium">対象ロール</span>
					<select name="targetRoleId" required class="field mt-1">
						<option value="">選択してください</option>
						{#each data.roles as role (role.id)}
							<option value={role.id}>{role.name}</option>
						{/each}
					</select>
				</label>

				<label class="block">
					<span class="text-sm font-medium">告知チャンネル</span>
					<select name="announcementChannelId" class="field mt-1">
						<option value="">告知しない</option>
						{#each data.channels as channel (channel.id)}
							<option value={channel.id}>#{channel.name}</option>
						{/each}
					</select>
				</label>

				<label class="block">
					<span class="text-sm font-medium">提出できる人</span>
					<select name="submitScope" class="field mt-1">
						<option value="everyone">ギルドメンバー全員</option>
						<option value="target_role">対象ロールの人のみ</option>
					</select>
				</label>

				<label class="block">
					<span class="text-sm font-medium">結果の公開範囲</span>
					<select name="visibility" class="field mt-1">
						<option value="public">公開</option>
						<option value="admin_only">管理者のみ</option>
						<option value="after_deadline">締切後に公開</option>
					</select>
				</label>

				<label class="block">
					<span class="text-sm font-medium">締切（告知用）</span>
					<input
						type="datetime-local"
						name="deadline"
						value={deadline}
						oninput={(event) => onDeadlineInput(event.currentTarget.value)}
						class="field mt-1"
					/>
				</label>

				<label class="block">
					<span class="text-sm font-medium">受付終了</span>
					<input
						type="datetime-local"
						name="closesAt"
						bind:value={closesAt}
						oninput={() => (closesAtTouched = true)}
						class="field mt-1"
					/>
					<span class="mt-1 block text-xs text-text-muted">空欄なら自動クローズしません。</span>
				</label>
			</div>

			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" name="allowEdit" checked class="size-4" />
				回答の編集を許可する
			</label>
		</section>

		<section class="flex flex-col gap-4">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-medium">質問</h2>
				<button
					type="button"
					class="chip"
					onclick={() => (questions = [...questions, newQuestion()])}
				>
					質問を追加
				</button>
			</div>

			{#each questions as q, index (q.key)}
				<div class="card flex flex-col gap-3 p-5">
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs text-text-muted">質問 {index + 1}</span>
						<div class="flex gap-1">
							<button
								type="button"
								class="chip"
								aria-label="質問 {index + 1} を上へ移動"
								disabled={index === 0}
								onclick={() => move(index, -1)}
							>
								↑
							</button>
							<button
								type="button"
								class="chip"
								aria-label="質問 {index + 1} を下へ移動"
								disabled={index === questions.length - 1}
								onclick={() => move(index, 1)}
							>
								↓
							</button>
							<!-- The server rejects an empty question set, so the last one must stay. -->
							<button
								type="button"
								class="chip"
								aria-label="質問 {index + 1} を削除"
								disabled={questions.length === 1}
								onclick={() => (questions = questions.filter((item) => item.key !== q.key))}
							>
								削除
							</button>
						</div>
					</div>

					<div class="grid gap-3 sm:grid-cols-[1fr_10rem]">
						<input
							bind:value={q.label}
							aria-label="質問 {index + 1} の質問文"
							placeholder="質問文"
							required
							maxlength={MAX_LABEL}
							class="field"
						/>
						<select
							value={q.type}
							aria-label="質問 {index + 1} の種類"
							onchange={(event) => onTypeChange(q, event.currentTarget.value as QuestionType)}
							class="field"
						>
							{#each QUESTION_TYPES as type (type)}
								<option value={type}>{QUESTION_TYPE_LABELS[type]}</option>
							{/each}
						</select>
					</div>

					<input
						bind:value={q.helpText}
						aria-label="質問 {index + 1} の補足"
						placeholder="補足（任意）"
						maxlength={MAX_HELP_TEXT}
						class="field"
					/>

					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={q.required} class="size-4" />
						必須
					</label>

					{#if hasOptions(q.type)}
						<div class="border-border flex flex-col gap-2 border-t pt-3">
							{#each q.options as option, optionIndex (option.id)}
								<div class="flex items-center gap-2">
									<input
										bind:value={option.label}
										aria-label="質問 {index + 1} の選択肢 {optionIndex + 1}"
										placeholder="選択肢"
										required
										maxlength={MAX_OPTION_LABEL}
										class="field"
									/>
									<button
										type="button"
										class="chip"
										aria-label="質問 {index + 1} の選択肢 {optionIndex + 1} を削除"
										disabled={q.options.length === 1}
										onclick={() => (q.options = q.options.filter((item) => item.id !== option.id))}
									>
										×
									</button>
									<span class="w-8 text-right text-xs text-text-muted">{optionIndex + 1}</span>
								</div>
							{/each}
							<button
								type="button"
								class="chip self-start"
								onclick={() => (q.options = [...q.options, newOption()])}
							>
								選択肢を追加
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</section>

		<div class="flex items-center gap-3">
			<button type="submit" class="btn-primary px-5 py-2.5">作成する</button>
			<a href="/" class="text-sm text-text-muted hover:underline">キャンセル</a>
		</div>
	</form>
</main>
