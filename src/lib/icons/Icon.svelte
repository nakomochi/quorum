<script lang="ts" module>
	// Path data from Lucide (https://lucide.dev), ISC License, © Lucide Contributors.
	const paths = {
		'arrow-left': ['m12 19-7-7 7-7', 'M19 12H5'],
		'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
		pencil: [
			'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
			'm15 5 4 4'
		],
		'chevron-up': ['m18 15-6-6-6 6'],
		'chevron-down': ['m6 9 6 6 6-6'],
		x: ['M18 6 6 18', 'm6 6 12 12'],
		plus: ['M5 12h14', 'M12 5v14'],
		check: ['M20 6 9 17l-5-5'],
		'external-link': [
			'M15 3h6v6',
			'M10 14 21 3',
			'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'
		],
		ellipsis: [],
		'undo-2': ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'],
		'redo-2': ['m15 14 5-5-5-5', 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13'],
		'grip-vertical': [],
		'grip-horizontal': [],
		clock: ['M12 6v6l4 2'],
		hourglass: [
			'M5 22h14',
			'M5 2h14',
			'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22',
			'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2'
		],
		lock: ['M7 11V7a5 5 0 0 1 10 0v4'],
		'circle-plus': ['M8 12h8', 'M12 8v8'],
		copy: ['M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2']
	} as const;

	export type IconName = keyof typeof paths;

	// Lucide draws these partly out of circles: `[cx, cy]` with r=1, or `[cx, cy, r]`.
	const circles: Partial<Record<IconName, [number, number, number?][]>> = {
		clock: [[12, 12, 10]],
		'circle-plus': [[12, 12, 10]],
		ellipsis: [
			[12, 12],
			[19, 12],
			[5, 12]
		],
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

	type Rect = { x: number; y: number; width: number; height: number; rx: number };

	const rects: Partial<Record<IconName, Rect[]>> = {
		lock: [{ x: 3, y: 11, width: 18, height: 11, rx: 2 }],
		copy: [{ x: 8, y: 8, width: 14, height: 14, rx: 2 }]
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
	{#each circles[name] ?? [] as [cx, cy, r = 1] (`${cx},${cy}`)}
		<circle {cx} {cy} {r} />
	{/each}
	{#each rects[name] ?? [] as { x, y, width, height, rx } (`${x},${y}`)}
		<rect {x} {y} {width} {height} {rx} />
	{/each}
</svg>
