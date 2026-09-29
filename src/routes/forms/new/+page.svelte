<script lang="ts">
	import { nanoid } from 'nanoid';
	import { onMount, tick, untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import {
		dragHandle,
		dragHandleZone,
		SHADOW_ITEM_MARKER_PROPERTY_NAME,
		type DndEvent
	} from 'svelte-dnd-action';
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { formatJstTime } from '$lib/datetime';
	import { DraftAutosave, fetchTransport, type SaveStatus } from '$lib/draft-autosave';
	import { draftPayload, questionsField, type DraftQuestion } from '$lib/form-draft';
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
	import Icon from '$lib/icons/Icon.svelte';

	// svelte-dnd-action identifies items by an `id` property, so the draft key is named for it.
	// Answers point at these option ids, so reordering must never mint new ones.
	type Option = { id: string; label: string };

	type Draft = {
		id: string;
		type: QuestionType;
		label: string;
		helpText: string;
		required: boolean;
		options: Option[];
		allowOther: boolean;
	};

	// Everything the editor owns, deep-copied so a history entry can never alias live state.
	type Snapshot = {
		questions: Draft[];
		deadline: string;
		closesAt: string;
		closesAtTouched: boolean;
	};

	// Shared by the zone and the items so the gap and the cards move together.
	const FLIP_MS = 150;

	// Long enough that a typed word is one step, short enough to feel like the last thing done.
	const SETTLE_MS = 400;
	const HISTORY_LIMIT = 50;

	// The title and description are uncontrolled and stay out of the snapshot, so their own
	// Ctrl+Z has to keep working.
	const NATIVE_UNDO = ['title', 'description'];

	const ROLE_MISSING = '元のロールが見つかりません。選び直してください';
	const CHANNEL_MISSING = '元のチャンネルが見つかりません。選び直してください';

	let { data, form } = $props();

	// Read once: the editor owns its state from here on, and a later load (after a refused
	// submission) must not overwrite what has been typed since.
	const restored = untrack(() => data.draft);
	const initial = restored?.state ?? null;

	const newOption = () => ({ id: nanoid(10), label: '' });

	function newQuestion(): Draft {
		return {
			id: nanoid(8),
			type: 'single',
			label: '',
			helpText: '',
			required: true,
			options: [newOption()],
			allowOther: false
		};
	}

	// A choice question always keeps one option to type into, as the editor's own buttons do.
	const fromSaved = (q: DraftQuestion): Draft => ({
		...q,
		id: nanoid(8),
		options:
			hasOptions(q.type) && q.options.length === 0
				? [newOption()]
				: q.options.map((option) => ({ ...option }))
	});

	let questions = $state<Draft[]>(
		initial && initial.questions.length > 0 ? initial.questions.map(fromSaved) : [newQuestion()]
	);
	let deadline = $state(initial?.deadline ?? '');
	let closesAt = $state(initial?.closesAt ?? '');
	// closesAt defaults to the announced deadline until the admin types their own value.
	let closesAtTouched = $state(initial?.closesAtTouched ?? false);

	// Controlled so that a stored id missing from today's options can be told apart from a choice.
	let targetRoleId = $state(initial?.targetRoleId ?? '');
	let announcementChannelId = $state(initial?.announcementChannelId ?? '');

	const roleMissing = $derived(
		targetRoleId !== '' && !data.roles.some((role) => role.id === targetRoleId)
	);
	const channelMissing = $derived(
		announcementChannelId !== '' &&
			!data.channels.some((channel) => channel.id === announcementChannelId)
	);

	/** Blocks the submission, with the reason in the browser's own bubble, until it is resolved. */
	const validity = (message: () => string) => (node: HTMLSelectElement) => {
		node.setCustomValidity(message());
	};

	const cloneQuestions = (items: Draft[]): Draft[] =>
		items.map((q) => ({ ...q, options: q.options.map((option) => ({ ...option })) }));

	const snapshot = (): Snapshot => ({
		questions: cloneQuestions(questions),
		deadline,
		closesAt,
		closesAtTouched
	});

	// Comparing serialised state is what keeps a no-op edit (a cancelled drag, retyping the same
	// character) from becoming a history step nobody asked for.
	const serialise = () => JSON.stringify([questions, deadline, closesAt, closesAtTouched]);

	// A restored draft starts with an empty history too.
	let past = $state.raw<Snapshot[]>([]);
	let future = $state.raw<Snapshot[]>([]);
	let baseline = snapshot();
	let baselineKey = $state(serialise());

	const stateKey = $derived(serialise());
	const pending = $derived(stateKey !== baselineKey);

	const canUndo = $derived(past.length > 0 || pending);
	// Any unbanked edit invalidates the redo stack, so the button must go dead with it.
	const canRedo = $derived(future.length > 0 && !pending);

	// A drag swaps a placeholder into the list until it is dropped, and a snapshot taken then would
	// bake that placeholder into history. Looking for the marker beats tracking a flag: a keyboard
	// drop ends with a `consider`, so a flag cleared on `finalize` would never come back down.
	const marked = (item: object) => SHADOW_ITEM_MARKER_PROPERTY_NAME in item;
	const midDrag = () => questions.some((q) => marked(q) || q.options.some(marked));

	function checkpoint() {
		if (midDrag() || !pending) return;
		past = [...past, baseline].slice(-HISTORY_LIMIT);
		future = [];
		baseline = snapshot();
		baselineKey = stateKey;
	}

	// Two checkpoints: the first banks whatever was half-typed, the second the structural change.
	function step(change: () => void) {
		checkpoint();
		change();
		checkpoint();
	}

	function apply(entry: Snapshot) {
		questions = cloneQuestions(entry.questions);
		deadline = entry.deadline;
		closesAt = entry.closesAt;
		closesAtTouched = entry.closesAtTouched;
		baseline = entry;
		baselineKey = serialise();
		restoreFocus();
	}

	function undo() {
		checkpoint();
		const previous = past.at(-1);
		if (!previous) return;
		past = past.slice(0, -1);
		future = [...future, baseline];
		apply(previous);
	}

	function redo() {
		checkpoint();
		const next = future.at(-1);
		if (!next) return;
		future = future.slice(0, -1);
		past = [...past, baseline];
		apply(next);
	}

	const payload = $derived(questionsField(questions));

	function onDeadlineInput(value: string) {
		deadline = value;
		if (!closesAtTouched) closesAt = value;
	}

	function move(index: number, delta: number) {
		const to = index + delta;
		if (to < 0 || to >= questions.length) return;
		step(() => {
			const next = [...questions];
			[next[index], next[to]] = [next[to], next[index]];
			questions = next;
		});
	}

	// Both events must be handled: `consider` opens the gap, `finalize` commits the drop.
	function onDnd(event: CustomEvent<DndEvent<Draft>>) {
		questions = event.detail.items;
		checkpoint();
	}

	function onOptionDnd(q: Draft, event: CustomEvent<DndEvent<Option>>) {
		q.options = event.detail.items;
		checkpoint();
	}

	// A type of its own per question keeps options inside their card and out of the question list.
	const optionZoneType = (q: Draft) => `option:${q.id}`;

	function onTypeChange(q: Draft, type: QuestionType) {
		step(() => {
			q.type = type;
			if (hasOptions(type) && q.options.length === 0) q.options = [newOption()];
			if (!hasOptions(type)) q.allowOther = false;
		});
	}

	// Undo swaps the whole list in, so the caret has to be put back by hand.
	let lastField: HTMLInputElement | null = null;

	function rememberField(event: FocusEvent) {
		const el = event.target;
		lastField = el instanceof HTMLInputElement && el.type === 'text' ? el : null;
	}

	async function restoreFocus() {
		const field = lastField;
		await tick();
		// A field that belonged to a question the undo removed is no longer in the document.
		if (!field?.isConnected) return;
		field.focus();
		field.setSelectionRange(field.value.length, field.value.length);
	}

	// Typing settles into one step instead of one per character. Compare the keys here rather than
	// reading `pending`: the effect has to depend on the text itself, or it never re-runs while a
	// change is outstanding and the wait turns into a fixed interval.
	$effect(() => {
		if (stateKey === baselineKey) return;
		const timer = setTimeout(checkpoint, SETTLE_MS);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		const onKeydown = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
			const target = event.target;
			if (target instanceof HTMLElement && NATIVE_UNDO.includes(target.getAttribute('name') ?? ''))
				return;

			const key = event.key.toLowerCase();
			if (key !== 'z' && key !== 'y') return;
			event.preventDefault();
			if (key === 'y' || event.shiftKey) redo();
			else undo();
		};

		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	// --- draft autosave ---

	let formElement: HTMLFormElement;

	/**
	 * The whole form as FormData sees it, rather than the undo snapshot: the title, description
	 * and settings live in the inputs. closesAtTouched is the one piece of state no field carries.
	 */
	function readEditor(): string {
		const fields: Record<string, string[]> = {};
		for (const [name, value] of new FormData(formElement)) {
			if (typeof value === 'string') (fields[name] ??= []).push(value);
		}
		return JSON.stringify(draftPayload(fields, closesAtTouched));
	}

	let saveStatus = $state<SaveStatus>(
		restored ? { kind: 'saved', at: restored.updatedAt } : { kind: 'idle' }
	);

	const autosave = new DraftAutosave({
		draft: restored && { id: restored.id, version: restored.version, updatedAt: restored.updatedAt },
		read: readEditor,
		transport: fetchTransport,
		onStatus: (status) => (saveStatus = status),
		onCreated: (id) => {
			// Replaced, not pushed: a reload opens the draft again, and Back still leaves the editor.
			const url = new URL(page.url);
			url.searchParams.set('draft', id);
			replaceState(url, page.state);
		}
	});

	onMount(() => {
		autosave.start();

		const onVisibility = () => {
			if (document.visibilityState === 'hidden') void autosave.flush(true);
		};
		const onPageHide = () => void autosave.flush(true);
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pagehide', onPageHide);

		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', onPageHide);
			// A link inside the app unmounts the editor without hiding the page.
			autosave.leave();
		};
	});

	// Reordering, adding, removing, undo and redo fire no input event of their own.
	let savedKey = untrack(() => stateKey);
	$effect(() => {
		const key = stateKey;
		if (key === savedKey || midDrag()) return;
		savedKey = key;
		autosave.changed();
	});
</script>

<main class="mx-auto flex max-w-3xl flex-col gap-6 px-6 pt-8 pb-12">
	<header>
		<h1 class="text-xl font-semibold tracking-tight">フォームを作成</h1>
	</header>

	{#if form?.message}
		<p role="alert" class="alert-error">
			{form.message}
		</p>
	{/if}

	<!-- use:enhance keeps the question editor's state when the server answers with fail(). -->
	<form
		method="POST"
		bind:this={formElement}
		use:enhance={async ({ formData }) => {
			// Nothing may be saved once the form exists: the draft is deleted with its creation.
			await autosave.stop();
			if (autosave.id) formData.set('draftId', autosave.id);
			return async ({ result, update }) => {
				await update();
				if (result.type !== 'redirect') autosave.resume();
			};
		}}
		onfocusin={rememberField}
		oninput={() => autosave.changed()}
		onchange={() => autosave.changed()}
		class="flex flex-col gap-6"
	>
		<input type="hidden" name="questions" value={payload} />

		<section class="card flex flex-col gap-4 p-5">
			<label class="block">
				<span class="text-sm font-medium">タイトル</span>
				<input
					name="title"
					value={initial?.title ?? ''}
					required
					maxlength={MAX_TITLE}
					class="field mt-1"
				/>
			</label>

			<label class="block">
				<span class="text-sm font-medium">説明</span>
				<textarea
					name="description"
					value={initial?.description ?? ''}
					rows="3"
					maxlength={MAX_DESCRIPTION}
					class="field mt-1"
				></textarea>
			</label>

			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="text-sm font-medium">対象ロール</span>
					<select
						name="targetRoleId"
						required
						bind:value={targetRoleId}
						{@attach validity(() => (roleMissing ? ROLE_MISSING : ''))}
						class="field mt-1"
					>
						{#if roleMissing}
							<!-- Keeps the stored id, so a reload shows the notice again instead of a default. -->
							<option value={targetRoleId} hidden>選択してください</option>
						{/if}
						<option value="">選択してください</option>
						{#each data.roles as role (role.id)}
							<option value={role.id}>{role.name}</option>
						{/each}
					</select>
					{#if roleMissing}
						<span class="mt-1 block text-xs text-warning">{ROLE_MISSING}</span>
					{/if}
				</label>

				<label class="block">
					<span class="text-sm font-medium">告知チャンネル</span>
					<!-- An empty value means no announcement, so a missing channel cannot fall back to it. -->
					<select
						name="announcementChannelId"
						bind:value={announcementChannelId}
						{@attach validity(() => (channelMissing ? CHANNEL_MISSING : ''))}
						class="field mt-1"
					>
						{#if channelMissing}
							<option value={announcementChannelId} hidden>選択してください</option>
						{/if}
						<option value="">告知しない</option>
						{#each data.channels as channel (channel.id)}
							<option value={channel.id}>#{channel.name}</option>
						{/each}
					</select>
					{#if channelMissing}
						<span class="mt-1 block text-xs text-warning">{CHANNEL_MISSING}</span>
					{/if}
				</label>

				<label class="block">
					<span class="text-sm font-medium">提出できる人</span>
					<select name="submitScope" value={initial?.submitScope ?? 'everyone'} class="field mt-1">
						<option value="everyone">サーバーのメンバー全員</option>
						<option value="target_role">対象ロールの人のみ</option>
					</select>
				</label>

				<label class="block">
					<span class="text-sm font-medium">結果の公開範囲</span>
					<select name="visibility" value={initial?.visibility ?? 'public'} class="field mt-1">
						<option value="public">公開</option>
						<option value="admin_only">管理者のみ</option>
						<option value="after_deadline">締切後または確定後に公開</option>
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
					<span class="mt-1 block text-xs text-text-muted">空欄なら自動では締め切りません。</span>
				</label>
			</div>

			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="allowEdit"
					checked={initial?.allowEdit ?? true}
					class="size-4"
				/>
				回答の編集を許可する
			</label>
		</section>

		<section class="flex flex-col gap-4">
			<div class="flex items-center justify-between gap-2">
				<h2 class="text-sm font-medium">質問</h2>
				<div class="flex gap-1">
					<!-- Ctrl+Z does the same, but a phone has no Ctrl and a shortcut is invisible. -->
					<button
						type="button"
						class="chip p-1.5"
						aria-label="元に戻す"
						title="元に戻す"
						disabled={!canUndo}
						onclick={undo}
					>
						<Icon name="undo-2" />
					</button>
					<button
						type="button"
						class="chip p-1.5"
						aria-label="やり直す"
						title="やり直す"
						disabled={!canRedo}
						onclick={redo}
					>
						<Icon name="redo-2" />
					</button>
					<button
						type="button"
						class="chip"
						onclick={() => step(() => (questions = [...questions, newQuestion()]))}
					>
						質問を追加
					</button>
				</div>
			</div>

			<!-- The zone's children must be the questions and nothing else, hence the extra wrapper. -->
			<div
				class="flex flex-col gap-4"
				use:dragHandleZone={{ items: questions, flipDurationMs: FLIP_MS, dropTargetStyle: {} }}
				onconsider={onDnd}
				onfinalize={onDnd}
			>
				{#each questions as q, index (q.id)}
					<div class="card flex flex-col gap-3 p-5" animate:flip={{ duration: FLIP_MS }}>
						<div
							use:dragHandle
							aria-label="質問 {index + 1} をドラッグして並び替え"
							class="outline-accent -mx-5 -mt-5 flex touch-none justify-center rounded-t-xl py-2 text-text-muted hover:text-text-subtle focus-visible:-outline-offset-2 focus-visible:outline-2"
						>
							<Icon name="grip-horizontal" />
						</div>

						<div class="flex items-center justify-between gap-2">
							<span class="text-xs text-text-muted">質問 {index + 1}</span>
							<div class="flex gap-1">
								<button
									type="button"
									class="chip p-1.5"
									aria-label="質問 {index + 1} を上へ移動"
									disabled={index === 0}
									onclick={() => move(index, -1)}
								>
									<Icon name="chevron-up" />
								</button>
								<button
									type="button"
									class="chip p-1.5"
									aria-label="質問 {index + 1} を下へ移動"
									disabled={index === questions.length - 1}
									onclick={() => move(index, 1)}
								>
									<Icon name="chevron-down" />
								</button>
								<!-- The server rejects an empty question set, so the last one must stay. -->
								<button
									type="button"
									class="chip"
									aria-label="質問 {index + 1} を削除"
									disabled={questions.length === 1}
									onclick={() =>
										step(() => (questions = questions.filter((item) => item.id !== q.id)))}
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
								<!-- Nested zone: its own type, so an option can never land in the question list. -->
								<div
									class="flex flex-col gap-2"
									use:dragHandleZone={{
										items: q.options,
										type: optionZoneType(q),
										flipDurationMs: FLIP_MS,
										dropTargetStyle: {}
									}}
									onconsider={(event) => onOptionDnd(q, event)}
									onfinalize={(event) => onOptionDnd(q, event)}
								>
									{#each q.options as option, optionIndex (option.id)}
										<div class="flex items-center gap-2" animate:flip={{ duration: FLIP_MS }}>
											<div
												use:dragHandle
												aria-label="質問 {index + 1} の選択肢 {optionIndex +
													1} をドラッグして並び替え"
												class="outline-accent shrink-0 touch-none rounded p-1 text-text-muted hover:text-text-subtle focus-visible:-outline-offset-2 focus-visible:outline-2"
											>
												<Icon name="grip-vertical" />
											</div>
											<input
												bind:value={option.label}
												aria-label="質問 {index + 1} の選択肢 {optionIndex + 1}"
												placeholder="選択肢"
												required
												maxlength={MAX_OPTION_LABEL}
												class="field min-w-0"
											/>
											<button
												type="button"
												class="chip p-1.5"
												aria-label="質問 {index + 1} の選択肢 {optionIndex + 1} を削除"
												disabled={q.options.length === 1}
												onclick={() =>
													step(
														() => (q.options = q.options.filter((item) => item.id !== option.id))
													)}
											>
												<Icon name="x" />
											</button>
											<span class="w-8 text-right text-xs text-text-muted">{optionIndex + 1}</span>
										</div>
									{/each}
								</div>
								<!-- Outside the zone, so it can neither be dragged nor have an option dropped below it. -->
								{#if q.allowOther}
									<div class="flex items-center gap-2">
										<span class="w-6 shrink-0"></span>
										<p class="field min-w-0 border-dashed text-text-muted">その他…</p>
										<button
											type="button"
											class="chip p-1.5"
											aria-label="質問 {index + 1} の「その他」を削除"
											onclick={() => step(() => (q.allowOther = false))}
										>
											<Icon name="x" />
										</button>
										<span class="w-8"></span>
									</div>
								{/if}
								<div class="flex flex-wrap items-center gap-2">
									<button
										type="button"
										class="chip"
										onclick={() => step(() => (q.options = [...q.options, newOption()]))}
									>
										選択肢を追加
									</button>
									{#if !q.allowOther}
										<button type="button" class="chip" onclick={() => step(() => (q.allowOther = true))}>
											「その他」を追加
										</button>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>

		{#if saveStatus.kind === 'conflict'}
			<div role="alert" class="alert-warning action-row">
				<p class="min-w-0 flex-1">
					別の画面でこの下書きが更新されたか、作成・破棄されました。この画面の自動保存は停止しています。
				</p>
				<button
					type="button"
					class="btn-secondary shrink-0 px-3 py-1.5 text-xs"
					onclick={() => location.reload()}
				>
					再読み込み
				</button>
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-x-4 gap-y-3">
			<button type="submit" class="btn-primary px-5 py-2.5">作成する</button>
			<p role="status" class="text-xs text-text-muted">
				{#if saveStatus.kind === 'saving'}
					保存中…
				{:else if saveStatus.kind === 'saved'}
					<span class="whitespace-nowrap">保存済み {formatJstTime(saveStatus.at)}</span>
				{:else if saveStatus.kind === 'failed'}
					<span class="text-error-fg">
						保存できませんでした{saveStatus.tooLarge
							? '。フォームが大きすぎます。質問や選択肢を減らしてください'
							: ''}
					</span>
				{/if}
			</p>
		</div>
	</form>
</main>
