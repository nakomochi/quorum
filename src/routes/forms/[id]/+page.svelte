<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import AnswerList from '$lib/components/AnswerList.svelte';
	import ContextLink from '$lib/components/ContextLink.svelte';
	import { displayJst } from '$lib/display-date';
	import {
		DraftAutosave,
		discardResponseDraft,
		responseDraftTransport,
		saveWhileMounted,
		type SaveStatus as DraftSaveStatus
	} from '$lib/draft-autosave';
	import type { AnswerValue, RevisionAnswers } from '$lib/forms';
	import { answersFromFields, draftDiffers } from '$lib/response-draft';
	import AnswerForm from './AnswerForm.svelte';
	import AnswerHistory from './AnswerHistory.svelte';
	import ConfirmationCard from './ConfirmationCard.svelte';
	import { watchExpiry } from './expiry.svelte';
	import FormHeader from './FormHeader.svelte';

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

	// The server still refuses a late submission, and that refusal ends in the same locked state.
	let expired = $state(false);
	watchExpiry(
		() => (data.closed ? undefined : data.form.closesAt?.getTime()),
		() => (expired = true)
	);

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

	onMount(() => saveWhileMounted(() => autosave));

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
			// A reset would put the fields back to what the form was opened with while it is still
			// shown, dropping what was typed.
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
		<FormHeader form={data.form} {closed} {submitted} />
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
						（{displayJst(restoredAt)} に保存）
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
			<AnswerForm
				questions={data.questions}
				source={formSource}
				{saveStatus}
				{closed}
				{submitted}
				{submitting}
				{submit}
				attach={track}
				onedit={edited}
				oncancel={cancelEditing}
			/>
		{/key}
	{:else if submitted}
		<ConfirmationCard
			{saved}
			submittedAt={data.submittedAt}
			updatedAt={data.updatedAt}
			{closed}
			editable={data.editable}
			{canEdit}
			unsent={unsent !== null}
			{discarding}
			onedit={() => openForm(submittedAnswers)}
			oncontinue={() => unsent && openForm(unsent)}
			ondiscard={discard}
		/>

		<section class="flex flex-col gap-3">
			<h2 class="section-title">あなたの回答</h2>
			<AnswerList questions={data.questions} answers={submittedAnswers} cards />
		</section>

		{#if data.history.length > 0}
			<AnswerHistory
				revisions={data.history}
				questions={data.questions}
				{canEdit}
				onload={loadRevision}
			/>
		{/if}
	{:else}
		<section class="card p-6">
			<h2 class="text-lg font-semibold">受付を終了しました</h2>
			<p class="mt-1 text-sm text-text-muted">このフォームは回答を受け付けていません。</p>
		</section>
	{/if}
</main>
