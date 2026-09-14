<script lang="ts" module>
	// Path data from Lucide (https://lucide.dev), ISC License, © Lucide Contributors.
	const paths = {
		'arrow-left': ['m12 19-7-7 7-7', 'M19 12H5'],
		'chevron-up': ['m18 15-6-6-6 6'],
		'chevron-down': ['m6 9 6 6 6-6'],
		x: ['M18 6 6 18', 'm6 6 12 12'],
		plus: ['M5 12h14', 'M12 5v14'],
		check: ['M20 6 9 17l-5-5'],
		'undo-2': ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'],
		'redo-2': ['m15 14 5-5-5-5', 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13'],
		'grip-vertical': [],
		'grip-horizontal': []
	} as const;

	export type IconName = keyof typeof paths;

	// Lucide draws the grips out of circles instead of paths: `[cx, cy]` pairs, all r=1.
	const circles: Partial<Record<IconName, [number, number][]>> = {
		'grip-vertical': [
			[9, 5],
			[9, 12],
			[9, 19],
			[15, 5],
			[15, 12],
			[15, 19]
		],
		'grip-horizontal': [
			[5, 9],
			[12, 9],
			[19, 9],
			[5, 15],
			[12, 15],
			[19, 15]
		]
	};
</script>

<script lang="ts">
	// Always decorative: the meaning belongs to the parent's label or adjacent text.
	let { name, class: className = 'size-4' }: { name: IconName; class?: string } = $props();
</script>

<svg
	class={className}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each paths[name] as d (d)}
		<path {d} />
	{/each}
	{#each circles[name] ?? [] as [cx, cy] (`${cx},${cy}`)}
		<circle {cx} {cy} r="1" />
	{/each}
</svg>
