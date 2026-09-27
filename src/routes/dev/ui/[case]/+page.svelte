<script lang="ts">
	import {
		ADMIN_CASES,
		ANSWER_CASES,
		HOME_CASES,
		NEW_CASES,
		RESULTS_CASES
	} from '$lib/dev/fixtures';
	// The real pages, not copies: a markup change must show up here without being mirrored.
	import HomePage from '../../../+page.svelte';
	import AnswerPage from '../../../forms/[id]/+page.svelte';
	import ResultsPage from '../../../forms/[id]/results/+page.svelte';
	import NewFormPage from '../../../forms/new/+page.svelte';
	import AdminFormsPage from '../../../admin/forms/+page.svelte';

	let { data } = $props();

	const home = $derived(HOME_CASES.find((entry) => entry.id === data.case));
	const answer = $derived(ANSWER_CASES.find((entry) => entry.id === data.case));
	const results = $derived(RESULTS_CASES.find((entry) => entry.id === data.case));
	const created = $derived(NEW_CASES.find((entry) => entry.id === data.case));
	const admin = $derived(ADMIN_CASES.find((entry) => entry.id === data.case));

	const setup = $derived([home, answer, results, created, admin].find(Boolean)?.setup);

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

{#if home}
	<HomePage data={home.data} />
{:else if answer}
	<AnswerPage data={answer.data} form={answer.form ?? null} />
{:else if results}
	<ResultsPage data={results.data} form={results.form ?? null} />
{:else if created}
	<NewFormPage data={created.data} form={created.form ?? null} />
{:else if admin}
	<AdminFormsPage data={admin.data} form={admin.form ?? null} />
{/if}
