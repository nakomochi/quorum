<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import type { ResolvedPathname } from '$app/types';
	import ContextLink from '$lib/components/ContextLink.svelte';
	import SaveStatus from '$lib/components/SaveStatus.svelte';
	import {
		DraftAutosave,
		fetchTransport,
		saveWhileMounted,
		type SaveStatus as DraftSaveStatus
	} from '$lib/draft-autosave';
	import { draftPayload, questionsField, type EditorState } from '$lib/form-draft';
	import type { InputError } from '$lib/forms';
	import {
		cloneQuestions,
		fromSaved,
		incomplete,
		midDrag,
		newQuestion,
		NO_LOCKS,
		type ChannelChoice,
		type Choice,
		type EditorLocks,
		type EditorQuestion
	} from './editor';
	import FormSettings from './FormSettings.svelte';
	import { EditHistory } from './history.svelte';
	import QuestionList from './QuestionList.svelte';

	/**
	 * The form editor, for a new form and for an edit of a published one. It saves its draft as it
	 * goes and posts the whole form to the page's action.
	 */
	type Props = {
		heading: string;
		roles: Choice[];
		channels: ChannelChoice[];
		/** The saved draft the editor starts from, or null for a blank form. */
		draft: { id: string; version: number; updatedAt: Date; state: EditorState } | null;
		/** The action's last result. */
		form: { inputError?: InputError; message?: string } | null;
		/** The action posted to. The page's default action when left out. */
		action?: string;
		submitLabel: string;
		locks?: EditorLocks;
		/** Posted with the form but kept out of the draft. */
		extraFields?: Record<string, string>;
		/** Why autosave stopped after a 409. */
		conflictMessage: string;
		/** Once the first save has created the draft. */
		ondraftcreated?: (id: string) => void;
		/** Each result of a submission, after the editor has taken it in. */
		onresult?: (result: ActionResult) => void | Promise<void>;
		/** Notices under the heading. */
		notices?: Snippet;
		/** Drawn under the deadline field, given its current value. */
		afterDeadline?: Snippet<[deadline: string]>;
		/** A link above the heading back to where the editor was opened from. */
		back?: { href: ResolvedPathname; label: string };
	};

	let {
		heading,
		roles,
		channels,
		draft,
		form,
		action,
		submitLabel,
		locks = NO_LOCKS,
		extraFields = {},
		conflictMessage,
		ondraftcreated,
		onresult,
		notices,
		afterDeadline,
		back
	}: Props = $props();

	// Everything the editor owns, deep-copied so a history entry can never alias live state.
	type Snapshot = {
		questions: EditorQuestion[];
		deadline: string;
		closesAt: string;
		closesAtTouched: boolean;
	};

	// The title and description stay out of the snapshot and keep the browser's own Ctrl+Z.
	const NATIVE_UNDO = ['title', 'description'];

	// Read once: the editor owns its state from here on, and a later load (after a refused
	// submission) must not overwrite what has been typed since.
	const restored = untrack(() => draft);
	const initial = restored?.state ?? null;

	let questions = $state<EditorQuestion[]>(
		initial && initial.questions.length > 0 ? initial.questions.map(fromSaved) : [newQuestion()]
	);
	let deadline = $state(initial?.deadline ?? '');
	let closesAt = $state(initial?.closesAt ?? '');
	let closesAtTouched = $state(initial?.closesAtTouched ?? false);

	const history = new EditHistory<Snapshot>({
		snapshot: () => ({ questions: cloneQuestions(questions), deadline, closesAt, closesAtTouched }),
		serialise: () => JSON.stringify([questions, deadline, closesAt, closesAtTouched]),
		restore: (entry) => {
			questions = cloneQuestions(entry.questions);
			deadline = entry.deadline;
			closesAt = entry.closesAt;
			closesAtTouched = entry.closesAtTouched;
			restoreFocus();
		},
		paused: () => midDrag(questions)
	});

	const payload = $derived(questionsField(questions));

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

	$effect(() => {
		const onKeydown = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
			const target = event.target;
			if (target instanceof HTMLElement && NATIVE_UNDO.includes(target.getAttribute('name') ?? ''))
				return;

			const key = event.key.toLowerCase();
			if (key !== 'z' && key !== 'y') return;
			event.preventDefault();
			if (key === 'y' || event.shiftKey) history.redo();
			else history.undo();
		};

		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	// --- draft autosave ---

	let formElement: HTMLFormElement;
	let questionList: ReturnType<typeof QuestionList>;

	// Shown until the next result. A 503, and an input error with no field or question to point at,
	// have no place on the form and go to a toast instead.
	const inputError = $derived(form?.inputError ?? null);

	/** Opens the question the server refused, or brings the refused field into view. */
	async function showInputError(error: InputError | undefined) {
		const at = error?.at;
		if (!at) return;
		if ('question' in at) await questionList.reveal(at.question);
		else if ('field' in at) {
			// A picker posts from a hidden field, which has no box to scroll to; its own box says so.
			const field =
				formElement.querySelector(`[data-field="${at.field}"]`) ??
				formElement.querySelector(`[name="${at.field}"]`);
			field?.scrollIntoView({ block: 'center' });
		}
	}

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

	let saveStatus = $state<DraftSaveStatus>(
		restored ? { kind: 'saved', at: restored.updatedAt } : { kind: 'idle' }
	);

	const autosave = new DraftAutosave({
		draft: restored && { id: restored.id, version: restored.version, updatedAt: restored.updatedAt },
		read: readEditor,
		transport: fetchTransport,
		onStatus: (status) => (saveStatus = status),
		onCreated: (id) => ondraftcreated?.(id)
	});

	onMount(() => saveWhileMounted(() => autosave));

	// Reordering, adding, removing, undo and redo fire no input event of their own.
	let savedKey = untrack(() => history.key);
	$effect(() => {
		const key = history.key;
		if (key === savedKey || midDrag(questions)) return;
		savedKey = key;
		autosave.changed();
	});

	/** For a page that is about to throw the draft away: nothing more is saved from here. */
	export function stopSaving() {
		void autosave.stop();
	}
</script>

<!-- From md the sides widen by the width of the open card's toolbar, which floats in the right one;
     the column itself stays as wide as before. -->
<main class="page max-w-3xl md:max-w-[55rem] md:px-20">
	<div class="flex flex-col gap-3">
		{#if back}
			<ContextLink href={back.href} label={back.label} direction="back" />
		{/if}
		<header>
			<h1 class="page-title">{heading}</h1>
		</header>
	</div>

	{@render notices?.()}

	<!-- use:enhance keeps the question editor's state when the server answers with fail(). -->
	<form
		method="POST"
		{action}
		bind:this={formElement}
		use:enhance={async ({ formData, cancel }) => {
			// The browser checked only the open card's fields; the closed cards draw none. Open the
			// first that would fail and let the browser report on it as usual.
			const unfinished = questions.findIndex(incomplete);
			if (unfinished !== -1) {
				cancel();
				await questionList.reveal(unfinished);
				formElement.reportValidity();
				return;
			}

			// Nothing may be saved once the form is created or the edit published: the draft goes
			// with it.
			await autosave.stop();
			if (autosave.id) formData.set('draftId', autosave.id);
			for (const [name, value] of Object.entries(extraFields)) formData.set(name, value);
			return async ({ result, update }) => {
				await update();
				if (result.type !== 'redirect') autosave.resume();
				if (result.type === 'failure') {
					await showInputError(result.data?.inputError as InputError | undefined);
				}
				await onresult?.(result);
			};
		}}
		onfocusin={rememberField}
		oninput={() => autosave.changed()}
		onchange={() => autosave.changed()}
		class="flex flex-col gap-6"
	>
		<input type="hidden" name="questions" value={payload} />

		<FormSettings
			{initial}
			{roles}
			{channels}
			{locks}
			{inputError}
			{afterDeadline}
			bind:deadline
			bind:closesAt
			bind:closesAtTouched
		/>

		<QuestionList
			bind:this={questionList}
			bind:questions
			{history}
			{inputError}
			typesLocked={locks.questionTypes}
		/>

		<SaveStatus
			status={saveStatus}
			savedLabel="保存済み"
			failedLabel="保存できませんでした"
			tooLargeHint="フォームが大きすぎます。質問や選択肢を減らしてください"
			{conflictMessage}
		>
			<button type="submit" class="btn-primary px-5 py-2.5">{submitLabel}</button>
		</SaveStatus>
	</form>
</main>
