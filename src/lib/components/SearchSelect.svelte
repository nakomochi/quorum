<script lang="ts" module>
	/** `hint` is drawn muted after the label and is not searched. */
	export type SearchOption = { value: string; label: string; hint?: string | null };
</script>

<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { tick, untrack } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { matchesQuery } from '$lib/search';

	/**
	 * A select whose list is narrowed by typing into it. The value is posted under `name` from a
	 * hidden field, which also stays in the form data while the box is disabled. A choice fires a
	 * bubbling `change` there, as a native select would, for whatever listens on the form.
	 */
	type Props = {
		/** The box's id, for a label's `for`. */
		id: string;
		name: string;
		value: string;
		options: SearchOption[];
		/** Shown while the value is none of the options. */
		placeholder: string;
		disabled?: boolean;
		/** Blocks the submission with this, in the browser's own bubble, while it is not empty. */
		invalidMessage?: string;
		'aria-invalid'?: boolean;
		'aria-describedby'?: string;
	};

	let {
		id,
		name,
		value = $bindable(),
		options,
		placeholder,
		disabled = false,
		invalidMessage = '',
		...described
	}: Props = $props();

	// Bits UI takes '' for "nothing chosen", which an option may stand for here ("告知しない").
	const NONE = '\u0000';
	const toKey = (v: string) => (v === '' ? NONE : v);
	const fromKey = (key: string) => (key === NONE ? '' : key);

	const labelOf = (v: string) => options.find((option) => option.value === v)?.label ?? '';

	let open = $state(false);
	/** What the list is narrowed by: the box's text once typed into, until the list closes. */
	let query = $state('');
	/** The box's text. Follows typing only outside an IME composition, so that it never rewrites the box mid-word. */
	let text = $state(untrack(() => labelOf(value)));

	let input = $state<HTMLInputElement | null>(null);
	let hidden: HTMLInputElement;

	const shown = $derived(
		query === '' ? options : options.filter((option) => matchesQuery(option.label, query))
	);

	/** Back to the chosen option's name, unnarrowed, as the list closes with or without a choice. */
	function settle() {
		query = '';
		text = labelOf(value);
	}

	async function choose(key: string) {
		value = fromKey(key);
		settle();
		await tick();
		hidden.dispatchEvent(new Event('change', { bubbles: true }));
	}

	function typed(event: Event & { currentTarget: HTMLInputElement }) {
		if (event instanceof InputEvent && event.isComposing) return;
		text = query = event.currentTarget.value;
	}

	// Chrome sends the composition's last input event before compositionend, still composing. An input
	// event sent again afterwards has Bits UI highlight the first of the narrowed options, as it does
	// after any other typing, so that Enter picks it.
	async function composed(event: CompositionEvent & { currentTarget: HTMLInputElement }) {
		const box = event.currentTarget;
		text = query = box.value;
		await tick();
		box.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function openOnClick() {
		if (disabled || open) return;
		open = true;
		// Typing then replaces the chosen name instead of adding to it.
		input?.select();
	}

	const validity = (node: HTMLInputElement) => {
		node.setCustomValidity(invalidMessage);
	};
</script>

<Combobox.Root
	type="single"
	value={toKey(value)}
	onValueChange={choose}
	bind:open
	onOpenChange={(next) => {
		if (!next) settle();
	}}
	{disabled}
	allowDeselect={false}
>
	<div class="relative mt-1">
		<Combobox.Input
			bind:ref={input}
			oninput={typed}
			oncompositionend={composed}
			onclick={openOnClick}
		>
			{#snippet child({ props })}
				<input
					{...props}
					{...described}
					{id}
					value={text}
					{placeholder}
					autocomplete="off"
					data-field={name}
					class="field pr-9"
					{@attach validity}
				/>
			{/snippet}
		</Combobox.Input>
		<Combobox.Trigger
			tabindex={-1}
			aria-label="一覧を開く"
			class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-text-muted disabled:cursor-not-allowed"
		>
			<Icon name="chevron-down" class="size-4" />
		</Combobox.Trigger>
	</div>

	<Combobox.Portal>
		<!-- Behind the translucent surface, as the menus do, so the page does not show through. -->
		<Combobox.Content
			sideOffset={4}
			collisionPadding={8}
			class="bg-bg z-30 w-(--bits-combobox-anchor-width) max-w-[calc(100vw_-_1rem)] rounded-lg shadow-lg"
		>
			<div class="bg-surface border-border overflow-hidden rounded-lg border">
				<Combobox.Viewport class="max-h-72 overflow-y-auto py-1">
					{#each shown as option (option.value)}
						<Combobox.Item
							value={toKey(option.value)}
							label={option.label}
							class="data-highlighted:bg-surface-raised flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm text-text-subtle data-selected:font-medium data-selected:text-text"
						>
							<span class="min-w-0 flex-1 truncate">{option.label}</span>
							{#if option.hint}
								<span class="max-w-[45%] shrink-0 truncate text-xs text-text-muted">{option.hint}</span>
							{/if}
						</Combobox.Item>
					{:else}
						<p class="px-3 py-2 text-sm text-text-muted">一致するものがありません</p>
					{/each}
				</Combobox.Viewport>
			</div>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>

<input type="hidden" bind:this={hidden} {name} {value} />
