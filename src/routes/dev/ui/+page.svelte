<script lang="ts">
	import { CASE_GROUPS, CASE_IDS } from '$lib/dev/fixtures';

	const WIDTHS = ['375px', '768px', '100%'] as const;
	const THEMES = ['system', 'light', 'dark'] as const;

	let width = $state<(typeof WIDTHS)[number]>('100%');
	let theme = $state<(typeof THEMES)[number]>('system');
	let height = $state(720);

	// Each case renders in its own document, so the theme has to ride along in the URL.
	const themeQuery = $derived(theme === 'system' ? '' : `?theme=${theme}`);

	$effect(() => {
		const root = document.documentElement;
		if (theme === 'system') delete root.dataset.theme;
		else root.dataset.theme = theme;
		return () => delete root.dataset.theme;
	});
</script>

<svelte:head><title>UI catalogue</title></svelte:head>

<main class="mx-auto flex max-w-[1600px] flex-col gap-8 px-6 py-10">
	<header
		class="bg-bg/95 sticky top-0 z-10 -mx-6 flex flex-wrap items-end justify-between gap-4
			px-6 py-4 backdrop-blur"
	>
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">UI Catalog</h1>
			<p class="mt-1 text-sm text-text-muted">
				for development — {CASE_IDS.length} cases, real components with fixture data
			</p>
		</div>
		<div class="flex items-center gap-4">
			<div class="flex items-center gap-2">
				<span class="text-xs text-text-muted">幅</span>
				{#each WIDTHS as value (value)}
					<button
						type="button"
						class="chip"
						class:border-border-active={width === value}
						class:text-text={width === value}
						onclick={() => (width = value)}
					>
						{value}
					</button>
				{/each}
			</div>
			<div class="flex items-center gap-2">
				<span class="text-xs text-text-muted">テーマ</span>
				{#each THEMES as value (value)}
					<button
						type="button"
						class="chip"
						class:border-border-active={theme === value}
						class:text-text={theme === value}
						onclick={() => (theme = value)}
					>
						{value}
					</button>
				{/each}
			</div>
			<label class="flex items-center gap-2 text-xs whitespace-nowrap text-text-muted">
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
			<h2 class="border-border flex flex-wrap items-baseline gap-3 border-b pb-2">
				<span class="text-sm font-medium text-text">{group.label}</span>
				<span class="font-mono text-xs text-text-muted">{group.route}</span>
			</h2>

			<div class="flex flex-col gap-6">
				{#each group.cases as entry (entry.id)}
					<article class="flex flex-col gap-2">
						<div class="flex flex-wrap items-baseline gap-3">
							<h3 class="text-sm font-medium text-text-subtle">{entry.title}</h3>
							<a
								href="/dev/ui/{entry.id}{themeQuery}"
								target="_blank"
								rel="noreferrer"
								class="font-mono text-xs text-text-muted hover:text-text-subtle hover:underline"
							>
								{entry.id} ↗
							</a>
						</div>
						<!-- iframe rather than inline: every page fills at least the viewport, so sharing a
						     document would break both the heights and the viewport-relative styles. -->
						<iframe
							src="/dev/ui/{entry.id}{themeQuery}"
							title={entry.title}
							loading="lazy"
							style="width: {width}; height: {height}px"
							class="border-border bg-bg max-w-full rounded-lg border"
						></iframe>
					</article>
				{/each}
			</div>
		</section>
	{/each}
</main>
