<script lang="ts">
	import { CASE_GROUPS, CASE_IDS } from '$lib/dev/fixtures';

	const WIDTHS = ['375px', '768px', '100%'] as const;

	let width = $state<(typeof WIDTHS)[number]>('100%');
	let height = $state(720);
</script>

<svelte:head><title>UI catalogue</title></svelte:head>

<main class="mx-auto flex max-w-[1600px] flex-col gap-8 px-6 py-10">
	<header
		class="sticky top-0 z-10 -mx-6 flex flex-wrap items-end justify-between gap-4 bg-slate-950/95
			px-6 py-4 backdrop-blur"
	>
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">UI Catalog</h1>
			<p class="mt-1 text-sm text-slate-400">
				for development — {CASE_IDS.length} cases, real components with fixture data
			</p>
		</div>
		<div class="flex items-center gap-4">
			<div class="flex items-center gap-2">
				<span class="text-xs text-slate-400">幅</span>
				{#each WIDTHS as value (value)}
					<button
						type="button"
						class="chip"
						class:border-slate-400={width === value}
						class:text-slate-100={width === value}
						onclick={() => (width = value)}
					>
						{value}
					</button>
				{/each}
			</div>
			<label class="flex items-center gap-2 text-xs whitespace-nowrap text-slate-400">
				高さ
				<input
					type="number"
					min="320"
					max="4000"
					step="80"
					bind:value={height}
					class="field w-24 py-1"
				/>
			</label>
		</div>
	</header>

	{#each CASE_GROUPS as group (group.label)}
		<section class="flex flex-col gap-4">
			<h2 class="flex flex-wrap items-baseline gap-3 border-b border-slate-800 pb-2">
				<span class="text-sm font-medium text-slate-200">{group.label}</span>
				<span class="font-mono text-xs text-slate-500">{group.route}</span>
			</h2>

			<div class="flex flex-col gap-6">
				{#each group.cases as entry (entry.id)}
					<article class="flex flex-col gap-2">
						<div class="flex flex-wrap items-baseline gap-3">
							<h3 class="text-sm font-medium text-slate-300">{entry.title}</h3>
							<a
								href="/dev/ui/{entry.id}"
								target="_blank"
								rel="noreferrer"
								class="font-mono text-xs text-slate-500 hover:text-slate-300 hover:underline"
							>
								{entry.id} ↗
							</a>
						</div>
						<!-- iframe rather than inline: every page is min-h-screen, so sharing a document
						     would break both the heights and the viewport-relative styles. -->
						<iframe
							src="/dev/ui/{entry.id}"
							title={entry.title}
							loading="lazy"
							style="width: {width}; height: {height}px"
							class="max-w-full rounded-lg border border-slate-800 bg-slate-950"
						></iframe>
					</article>
				{/each}
			</div>
		</section>
	{/each}
</main>
