<script lang="ts">
	import {
		ADMIN_CASES,
		ANSWER_CASES,
		draftApiResponse,
		HISTORY_CASES,
		HOME_CASES,
		NEW_CASES,
		RESULTS_CASES
	} from '$lib/dev/fixtures';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	// The real pages, not copies: a markup change must show up here without being mirrored.
	import HomePage from '../../../+page.svelte';
	import AnswerPage from '../../../forms/[id]/+page.svelte';
	import ResultsPage from '../../../forms/[id]/results/+page.svelte';
	import HistoryPage from '../../../forms/[id]/results/[responseId]/+page.svelte';
	import NewFormPage from '../../../forms/new/+page.svelte';
	import AdminFormsPage from '../../../admin/forms/+page.svelte';

	let { data } = $props();

	const home = $derived(HOME_CASES.find((entry) => entry.id === data.case));
	const answer = $derived(ANSWER_CASES.find((entry) => entry.id === data.case));
	const results = $derived(RESULTS_CASES.find((entry) => entry.id === data.case));
	const history = $derived(HISTORY_CASES.find((entry) => entry.id === data.case));
	const created = $derived(NEW_CASES.find((entry) => entry.id === data.case));
	const admin = $derived(ADMIN_CASES.find((entry) => entry.id === data.case));

	const entry = $derived([home, answer, results, history, created, admin].find(Boolean));
	const setup = $derived(entry?.setup);

	// The editor and the answer page save drafts through fetch. The catalogue answers in the
	// server's place, so that nothing shown here can write to the database, and each case picks the
	// answer it shows. Children mount first, but the first save waits for its debounce.
	const isDraftApi = (path: string) =>
		path.startsWith('/forms/drafts') || /^\/forms\/[^/]+\/draft$/.test(path);

	$effect(() => {
		const passthrough = window.fetch;
		window.fetch = (input, init) => {
			const url = new URL(input instanceof Request ? input.url : String(input), location.href);
			if (!isDraftApi(url.pathname)) return passthrough(input, init);
			const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
			return draftApiResponse(entry?.draftApi ?? 'ok', method.toUpperCase());
		};
		return () => {
			window.fetch = passthrough;
		};
	});

	$effect(() => {
		setup?.(document);
	});

	// The catalogue's theme picker reaches this document through `?theme=`.
	$effect(() => {
		const root = document.documentElement;
		if (data.theme) root.dataset.theme = data.theme;
		else delete root.dataset.theme;
	});
</script>

<svelte:head><title>{data.case} — UI catalogue</title></svelte:head>

<!-- The root layout leaves its header out here, so the case's own layout data draws one instead. -->
{#if entry?.data.user}
	<SiteHeader user={entry.data.user} member={entry.data.member} isAdmin={entry.data.isAdmin} />
{/if}

{#if home}
	<HomePage data={home.data} form={home.form ?? null} />
{:else if answer}
	<AnswerPage data={answer.data} form={answer.form ?? null} />
{:else if results}
	<ResultsPage data={results.data} form={results.form ?? null} />
{:else if history}
	<HistoryPage data={history.data} />
{:else if created}
	<NewFormPage data={created.data} form={created.form ?? null} />
{:else if admin}
	<AdminFormsPage data={admin.data} form={admin.form ?? null} />
{/if}
