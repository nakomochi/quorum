<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import AnswerList from '$lib/components/AnswerList.svelte';
	import ContextLink from '$lib/components/ContextLink.svelte';
	import ItemHeader from '$lib/components/ItemHeader.svelte';
	import MetaLine from '$lib/components/MetaLine.svelte';
	import RevisionList from '$lib/components/RevisionList.svelte';
	import SaveStatus from '$lib/components/SaveStatus.svelte';
	import { formatJst } from '$lib/datetime';
	import {
		DraftAutosave,
		discardResponseDraft,
		responseDraftTransport,
		type SaveStatus as DraftSaveStatus
	} from '$lib/draft-autosave';
	import {
		MAX_OTHER_ANSWER,
		MAX_TEXT_ANSWER,
		OTHER_OPTION_ID,
		type AnswerValue,
		type RevisionAnswers
	} from '$lib/forms';
	import { answersFromFields, draftDiffers } from '$lib/response-draft';
	import Icon from '$lib/icons/Icon.svelte';

	let { data, form } = $props();

	type Answers = Record<string, AnswerValue | undefined>;
	type Revision = (typeof data.history)[number];

	const submittedAnswers = $derived(data.answers as Answers);

	// Read once: from here on the page tracks its draft itself, and a later load (after a refused
	// submission) must not replace what has been typed since.
	const initialDraft = untrack(() => data.draft);

	// What the form's fields start from. Set whenever the form is opened on other answers, and
	// `formKey` then redraws the fields, which take their values from it only when created.
	let formSource = $state<Answers>(untrack(() => initialDraft?.answers ?? data.answers));
	let formKey = $state(0);

	// Answers saved as a draft and not sent, as far as this page knows: restored by the load, or
	// left behind by キャンセル.
	let unsent = $state<Answers | null>(initialDraft?.answers ?? null);
	// Set while the notice for a draft restored on opening the page is shown.
	let restoredAt = $state<Date | null>(initialDraft?.answers ? initialDraft.updatedAt : null);

	// Both follow the latest action result, and 回答を編集 overrides them until the next one
	// arrives: an input error or a close keeps the form open, anything else returns to the
	// confirmation.
	let editing = $derived(form?.message !== undefined || form?.reason === 'closed');
	let saved = $derived(form?.created);
	let submitting = $state(false);

	// setTimeout fires at once past 2^31-1 ms (about 24.8 days), so a longer wait is taken in steps.
	const MAX_TIMEOUT = 2 ** 31 - 1;

	// Read off this browser's clock, which may be wrong. The server still refuses a late
	// submission, and that refusal ends in the same locked state.
	let expired = $state(false);

	$effect(() => {
		const closesAt = data.form.closesAt?.getTime();
		if (data.closed || closesAt === undefined) return;

		let timer: ReturnType<typeof setTimeout> | undefined;
		const wait = () => {
			const remaining = closesAt - Date.now();
			if (remaining <= 0) expired = true;
			else timer = setTimeout(wait, Math.min(remaining, MAX_TIMEOUT));
		};
		wait();
		return () => clearTimeout(timer);
	});

	// --- draft autosave ---

	let saveStatus = $state<DraftSaveStatus>(
		initialDraft?.answers ? { kind: 'saved', at: initialDraft.updatedAt } : { kind: 'idle' }
	);

	// A save refused as closed locks the page the same way a refused submission does.
	const closed = $derived(
		data.closed || expired || form?.reason === 'closed' || saveStatus.kind === 'closed'
	);

	let formElement = $state<HTMLFormElement>();

	function readFields(): RevisionAnswers {
		return formElement ? answersFromFields(new FormData(formElement), data.questions) : {};
	}

	// What autosave sends. Kept up to date on every edit rather than read at save time, so that a
	// save still due once the form has closed (キャンセル) sends what it last held.
	let currentText = JSON.stringify(untrack(() => formSource));

	function capture() {
		if (formElement) currentText = JSON.stringify(readFields());
	}

	function newAutosave(draft: { version: number; updatedAt: Date } | null) {
		const formId = untrack(() => data.form.id);
		return new DraftAutosave({
			draft: draft && { id: formId, version: draft.version, updatedAt: draft.updatedAt },
			read: () => currentText,
			transport: responseDraftTransport(formId),
			onStatus: (status) => (saveStatus = status)
		});
	}

	// Replaced once the draft is gone (sent or discarded): the next save creates it again.
	let autosave = newAutosave(initialDraft);

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
			autosave.leave();
		};
	});

	$effect(() => {
		if (closed) void autosave.stop();
	});

	function edited() {
		capture();
		autosave.changed();
	}

	/** Takes the fields as they are drawn, each time the form is created. */
	function track(node: HTMLFormElement) {
		formElement = node;
		untrack(capture);
		return () => {
			if (formElement === node) formElement = undefined;
		};
	}

	function resetDraft() {
		autosave = newAutosave(null);
		autosave.start();
		unsent = null;
		restoredAt = null;
		saveStatus = { kind: 'idle' };
	}

	// --- opening and leaving the form ---

	const submitted = $derived(data.submittedAt !== null);
	// Held open while a save is in flight: its reload lands before its result, and the
	// confirmation would otherwise flash up with the heading meant for a later visit.
	// A close refused by the server keeps the form too, with what was typed, after the reload
	// has marked it not editable.
	const showForm = $derived(
		(data.editable || form?.reason === 'closed') && (!submitted || editing || submitting)
	);
	const canEdit = $derived(data.editable && !closed);

	function openForm(source: Answers) {
		formSource = source;
		formKey++;
		editing = true;
		saved = undefined;
	}

	async function loadRevision(revision: Revision) {
		if (unsent && !confirm('未送信の変更を、この版の内容で置き換えます')) return;
		openForm(revision.answers);
		await tick();
		// Saved as an unsent change like anything typed: only sending makes it a new revision.
		edited();
		formElement?.scrollIntoView({ block: 'start' });
	}

	function cancelEditing() {
		const current = readFields();
		void autosave.flush();
		unsent = draftDiffers(current, data.answers) ? current : null;
		editing = false;
	}

	let discarding = $state(false);
	let discardFailed = $state(false);

	async function discard() {
		if (!confirm('未送信の変更を破棄します')) return;

		discarding = true;
		discardFailed = false;
		await autosave.stop();
		if (await discardResponseDraft(data.form.id)) {
			resetDraft();
			if (submitted) {
				editing = false;
			} else {
				formSource = submittedAnswers;
				formKey++;
			}
			discarding = false;
			return;
		}
		discarding = false;
		discardFailed = true;
		autosave.resume();
	}

	// --- display ---

	const heading = $derived(
		saved === true ? '回答を送信しました' : saved === false ? '回答を更新しました' : '回答済みです'
	);

	// Minute precision: an edit within the same minute as the submission adds nothing to show.
	const updatedAt = $derived(
		data.updatedAt && formatJst(data.updatedAt) !== formatJst(data.submittedAt)
			? formatJst(data.updatedAt)
			: null
	);

	const isChecked = (questionId: number, optionId: string) => {
		const value = formSource[questionId];
		if (value?.type === 'single') return 'optionId' in value && value.optionId === optionId;
		if (value?.type === 'multi') return value.optionIds.includes(optionId);
		return false;
	};

	const otherValue = (questionId: number): string | undefined => {
		const value = formSource[questionId];
		if (value?.type === 'single') return 'other' in value ? value.other : undefined;
		if (value?.type === 'multi') return value.other;
		return undefined;
	};

	const textValue = (questionId: number) => {
		const value = formSource[questionId];
		if (value?.type === 'text') return value.text;
		if (value?.type === 'date') return value.date;
		return '';
	};

	type Question = (typeof data.questions)[number];

	const otherChoiceId = (questionId: number) => `q_${questionId}_other_choice`;

	function otherChoice(questionId: number): HTMLInputElement | null {
		const choice = document.getElementById(otherChoiceId(questionId));
		return choice instanceof HTMLInputElement ? choice : null;
	}

	// Typing an "その他" answer chooses it, as in Google Forms.
	function chooseOther(questionId: number, text: string) {
		const choice = otherChoice(questionId);
		if (text.trim() === '' || !choice || choice.checked) return;
		choice.checked = true;
		// A scripted check fires no event, and checkQuestion listens for one.
		choice.dispatchEvent(new Event('change', { bubbles: true }));
	}

	/** Runs `check` on mount, which covers a restored answer, and after every edit inside `node`. */
	function recheck<T extends HTMLElement>(node: T, check: (node: T) => void) {
		const run = () => check(node);
		run();
		node.addEventListener('input', run);
		node.addEventListener('change', run);
		return {
			destroy() {
				node.removeEventListener('input', run);
				node.removeEventListener('change', run);
			}
		};
	}

	// `required` lets whitespace through, and the server trims before checking.
	function requireFilled(field: HTMLInputElement | HTMLTextAreaElement, required: boolean) {
		field.setCustomValidity(required && field.value.trim() === '' ? '入力してください' : '');
	}

	// The browser has no "at least one" for checkboxes, and the "その他" text is only required
	// while its choice is picked. A custom validity puts the browser's bubble beside the control.
	function checkQuestion(fieldset: HTMLFieldSetElement, q: Question) {
		if (q.type === 'multi' && q.required) {
			const boxes = fieldset.querySelectorAll<HTMLInputElement>(`input[name="q_${q.id}"]`);
			const picked = [...boxes].some((box) => box.checked);
			boxes[0]?.setCustomValidity(picked ? '' : 'いずれかを選択してください');
		}

		const other = fieldset.querySelector<HTMLInputElement>(`input[name="q_${q.id}_other"]`);
		if (other) {
			other.required = otherChoice(q.id)?.checked ?? false;
			requireFilled(other, other.required);
		}

		const text = fieldset.querySelector<HTMLTextAreaElement>(`textarea[name="q_${q.id}"]`);
		if (text) requireFilled(text, q.required);
	}

	const submit: SubmitFunction = async ({ cancel }) => {
		if (closed) {
			cancel();
			return;
		}
		submitting = true;
		// A successful submission deletes the draft, so no save may follow it, nor land after it.
		await autosave.stop();
		return async ({ result, update }) => {
			const reason = result.type === 'failure' ? result.data?.reason : undefined;
			// The fields take their values from props, so a reset would blank them with no change in
			// data to draw them again. The same keeps them through the reload below.
			await update({ reset: false });
			// A refusal means the page is out of date, and the reload shows why: the error page once
			// access is gone, the confirmation once another tab has submitted, the lock once closed.
			if (reason) await invalidateAll();
			submitting = false;
			if (result.type === 'success') resetDraft();
			// An input error or a passing fault leaves the draft as it was, and saving goes on.
			else if (!reason) autosave.resume();
			// Most outcomes are shown at the top, and the submit button sits at the bottom of the
			// form. A close is shown beside the button instead, where the reader already is.
			if (result.type === 'success' || (result.type === 'failure' && reason !== 'closed')) {
				window.scrollTo({ top: 0 });
			}
		};
	};
</script>

<main class="page">
	<div class="flex flex-col gap-3">
		{#if data.resultsVisible}
			<ContextLink href="/forms/{data.form.id}/results" label="回答状況を見る" direction="forward" />
		{/if}

		<!-- The accent bar is a clipped child, not a `border-t-4`: the rounded top corners would
		     otherwise render the border as a thickening wedge. -->
		<header class="card overflow-hidden">
			<div class="bg-accent h-1.5"></div>
			<div class="p-6">
				<ItemHeader title={data.form.title} tag="h1" titleClass="page-title text-2xl" wrap>
					{#snippet badges()}
						{#if closed}<span class="badge badge-muted">受付終了</span>{/if}
						{#if submitted}<span class="badge badge-success">提出済み</span>{/if}
					{/snippet}
				</ItemHeader>
				{#if data.form.description}
					<p class="mt-2 text-sm whitespace-pre-wrap text-text-subtle">{data.form.description}</p>
				{/if}
				<MetaLine
					class="mt-4"
					items={[
						{ label: '締切', value: formatJst(data.form.deadline, 'なし') },
						{ label: '受付終了', value: formatJst(data.form.closesAt, '指定なし') }
					]}
				/>
			</div>
		</header>
	</div>

	{#if form?.message}
		<p role="alert" class="alert-error">
			{form.message}
		</p>
	{:else if form?.reason === 'already_submitted'}
		<p role="alert" class="alert-warning">
			すでに提出済みの回答があり、編集は許可されていないため、今回の内容は送信されていません。
		</p>
	{/if}

	{#if discardFailed}
		<p role="alert" class="alert-error">
			下書きを破棄できませんでした。時間をおいてもう一度お試しください。
		</p>
	{/if}

	{#if showForm}
		{#if restoredAt && !submitted && !closed}
			<div class="card action-row px-4 py-3">
				<p class="min-w-0 flex-1 text-sm text-text-subtle">
					下書きを復元しました
					<span class="whitespace-nowrap text-xs text-text-muted">
						（{formatJst(restoredAt)} に保存）
					</span>
				</p>
				<button
					type="button"
					class="btn-secondary btn-sm shrink-0 self-start sm:self-auto"
					disabled={discarding}
					onclick={discard}
				>
					下書きを破棄
				</button>
			</div>
		{/if}

		{#key formKey}
			<form
				method="POST"
				use:enhance={submit}
				{@attach track}
				oninput={edited}
				onchange={edited}
				class="flex scroll-mt-4 flex-col gap-5"
			>
				{#each data.questions as q (q.id)}
					<!-- The card is the wrapper, not the fieldset: a bordered fieldset lets the browser cut a
					     notch for the legend and start its padding below it, which misaligns the heading. -->
					<div class="card p-5">
						<fieldset
							class="m-0 border-0 p-0"
							use:recheck={(fieldset) => checkQuestion(fieldset, q)}
						>
							<legend class="mb-3 block text-sm font-medium">
								{q.label}
								{#if q.required}<span class="text-danger">*</span>{/if}
							</legend>
							{#if q.helpText}
								<p class="-mt-2 mb-3 text-xs text-text-muted">{q.helpText}</p>
							{/if}

							{#if q.type === 'single' || q.type === 'multi'}
								<div class="flex flex-col gap-2">
									{#each q.options ?? [] as option (option.id)}
										<label class="flex items-center gap-2 text-sm">
											<input
												type={q.type === 'single' ? 'radio' : 'checkbox'}
												name="q_{q.id}"
												value={option.id}
												checked={isChecked(q.id, option.id)}
												required={q.required && q.type === 'single'}
												class="accent-accent size-4"
											/>
											{option.label}
										</label>
									{/each}
									{#if q.allowOther}
										<div class="flex items-center gap-2 text-sm">
											<label class="flex shrink-0 items-center gap-2">
												<input
													type={q.type === 'single' ? 'radio' : 'checkbox'}
													id={otherChoiceId(q.id)}
													name="q_{q.id}"
													value={OTHER_OPTION_ID}
													checked={otherValue(q.id) !== undefined}
													required={q.required && q.type === 'single'}
													class="accent-accent size-4"
												/>
												その他:
											</label>
											<input
												type="text"
												name="q_{q.id}_other"
												value={otherValue(q.id) ?? ''}
												aria-label="「{q.label}」のその他の内容"
												maxlength={MAX_OTHER_ANSWER}
												oninput={(event) => chooseOther(q.id, event.currentTarget.value)}
												class="field min-w-0 flex-1 py-1"
											/>
										</div>
									{/if}
								</div>
							{:else if q.type === 'text'}
								<textarea
									name="q_{q.id}"
									rows="3"
									aria-label={q.label}
									required={q.required}
									maxlength={MAX_TEXT_ANSWER}
									class="field">{textValue(q.id)}</textarea
								>
							{:else}
								<input
									type="date"
									name="q_{q.id}"
									value={textValue(q.id)}
									aria-label={q.label}
									required={q.required}
									class="field"
								/>
							{/if}
						</fieldset>
					</div>
				{/each}

				<SaveStatus
					status={saveStatus}
					savedLabel="下書きを保存済み"
					failedLabel="下書きを保存できませんでした"
					tooLargeHint="回答が大きすぎます。入力を短くしてください"
					conflictMessage="別の画面でこの回答が送信されたか、下書きが更新・破棄されました。この画面の自動保存は停止しています。"
					closedMessage={closed ? '受付を終了したため送信できません。' : null}
				>
					<button type="submit" class="btn-primary px-5 py-2.5" disabled={submitting || closed}>
						{submitted ? '回答を更新' : '送信'}
					</button>
					{#if submitted}
						<button
							type="button"
							class="text-sm text-text-muted hover:underline"
							onclick={cancelEditing}
						>
							キャンセル
						</button>
					{/if}
				</SaveStatus>
			</form>
		{/key}
	{:else if submitted}
		<section class="card flex flex-col gap-4 p-6">
			<div class="action-row">
				<div class="flex min-w-0 flex-1 items-start gap-3">
					<span class="bg-success-badge text-success shrink-0 rounded-full p-1.5">
						<Icon name="check" />
					</span>
					<div class="min-w-0">
						<h2 class="text-lg font-semibold">{heading}</h2>
						<MetaLine
							class="mt-1"
							items={[
								{ label: '提出', value: formatJst(data.submittedAt) },
								...(updatedAt ? [{ label: '更新', value: updatedAt }] : [])
							]}
						/>
						{#if closed}
							<p class="mt-2 text-sm text-text-subtle">受付は終了しています。</p>
						{:else if !data.editable}
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
						onclick={() => openForm(submittedAnswers)}
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
							onclick={() => unsent && openForm(unsent)}
						>
							<Icon name="pencil" />
							続きを編集
						</button>
						<button
							type="button"
							class="btn-secondary px-4 py-2"
							disabled={discarding}
							onclick={discard}
						>
							破棄
						</button>
					</div>
				</div>
			{/if}
		</section>

		<section class="flex flex-col gap-3">
			<h2 class="section-title">あなたの回答</h2>
			<AnswerList questions={data.questions} answers={submittedAnswers} cards />
		</section>

		{#if data.history.length > 0}
			<section class="flex flex-col gap-3">
				<h2 class="section-title">回答履歴</h2>
				<RevisionList revisions={data.history} questions={data.questions} headingTag="h3">
					{#snippet actions(revision, index)}
						{#if canEdit && index > 0}
							<button
								type="button"
								class="btn-secondary btn-sm shrink-0"
								onclick={() => loadRevision(revision)}
							>
								この内容を読み込む
							</button>
						{/if}
					{/snippet}
				</RevisionList>
			</section>
		{/if}
	{:else}
		<section class="card p-6">
			<h2 class="text-lg font-semibold">受付を終了しました</h2>
			<p class="mt-1 text-sm text-text-muted">このフォームは回答を受け付けていません。</p>
		</section>
	{/if}
</main>
