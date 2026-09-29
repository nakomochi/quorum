<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import FieldError from '$lib/components/FieldError.svelte';
	import SaveStatus from '$lib/components/SaveStatus.svelte';
	import {
		DraftAutosave,
		fetchTransport,
		saveWhileMounted,
		type SaveStatus as DraftSaveStatus
	} from '$lib/draft-autosave';
	import { draftPayload, questionsField } from '$lib/form-draft';
	import type { InputError } from '$lib/forms';
	import {
		cloneQuestions,
		fromSaved,
		incomplete,
		midDrag,
		newQuestion,
		type EditorQuestion
	} from './editor';
	import FormSettings from './FormSettings.svelte';
	import { EditHistory } from './history.svelte';
	import QuestionList from './QuestionList.svelte';

	// Everything the editor owns, deep-copied so a history entry can never alias live state.
	type Snapshot = {
		questions: EditorQuestion[];
		deadline: string;
		closesAt: string;
		closesAtTouched: boolean;
	};

	// The title and description stay out of the snapshot and keep the browser's own Ctrl+Z.
	const NATIVE_UNDO = ['title', 'description'];

	let { data, form } = $props();

	// Read once: the editor owns its state from here on, and a later load (after a refused
	// submission) must not overwrite what has been typed since.
	const restored = untrack(() => data.draft);
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

	// Shown until the next result. A 503 has no place on the form and goes to a toast instead.
	const inputError = $derived(form?.inputError ?? null);
	const formError = $derived(inputError && !inputError.at ? inputError.message : null);

	/** Opens the question the server refused, or brings the refused field into view. */
	async function showInputError(error: InputError | undefined) {
		const at = error?.at;
		if (!at) return;
		if ('question' in at) await questionList.reveal(at.question);
		else if ('field' in at) {
			formElement.querySelector(`[name="${at.field}"]`)?.scrollIntoView({ block: 'center' });
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
		onCreated: (id) => {
			// Replaced, not pushed: a reload opens the draft again, and Back still leaves the editor.
			const url = new URL(page.url);
			url.searchParams.set('draft', id);
			replaceState(url, page.state);
		}
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
</script>

<!-- From md the sides widen by the width of the open card's toolbar, which floats in the right one;
     the column itself stays as wide as before. -->
<main class="page max-w-3xl md:max-w-[55rem] md:px-20">
	<header>
		<h1 class="page-title">フォームを作成</h1>
	</header>

	<!-- use:enhance keeps the question editor's state when the server answers with fail(). -->
	<form
		method="POST"
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

			// Nothing may be saved once the form exists: the draft is deleted with its creation.
			await autosave.stop();
			if (autosave.id) formData.set('draftId', autosave.id);
			return async ({ result, update }) => {
				await update();
				if (result.type !== 'redirect') autosave.resume();
				if (result.type === 'failure') {
					await showInputError(result.data?.inputError as InputError | undefined);
				}
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
			roles={data.roles}
			channels={data.channels}
			{inputError}
			bind:deadline
			bind:closesAt
			bind:closesAtTouched
		/>

		<QuestionList bind:this={questionList} bind:questions {history} {inputError} />

		<SaveStatus
			status={saveStatus}
			savedLabel="保存済み"
			failedLabel="保存できませんでした"
			tooLargeHint="フォームが大きすぎます。質問や選択肢を減らしてください"
			conflictMessage="別の画面でこの下書きが更新されたか、作成・破棄されました。この画面の自動保存は停止しています。"
		>
			<FieldError message={formError} class="w-full" />
			<button type="submit" class="btn-primary px-5 py-2.5">作成する</button>
		</SaveStatus>
	</form>
</main>
