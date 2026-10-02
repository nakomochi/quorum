<script lang="ts" module>
	import type { ResolvedPathname } from '$app/types';

	export type MenuItem =
		| { kind: 'link'; label: string; href: ResolvedPathname }
		| {
				kind: 'post';
				label: string;
				action: string;
				/** Sent as hidden inputs. */
				fields?: Record<string, string>;
				/** Asked first; declining posts nothing. */
				confirm?: string;
				/** Stays on the page and reruns its load instead of navigating to the result. */
				enhance?: boolean;
				danger?: boolean;
		  };

	type PostItem = Extract<MenuItem, { kind: 'post' }>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';

	type Props = {
		/** The trigger's accessible name; the menu is labelled by the trigger. */
		label: string;
		items: MenuItem[];
		/** The trigger's content. */
		trigger: Snippet;
		triggerClass?: string;
		/** A line of plain text above the items, outside the menu role. */
		header?: Snippet;
	};

	let { label, items, trigger, triggerClass = '', header }: Props = $props();

	const id = $props.id();

	/** Keeps the popup this far from the viewport's edges. */
	const MARGIN = 8;

	let open = $state(false);
	let focusOnOpen: 'first' | 'last' = 'first';

	let root: HTMLDivElement;
	let button: HTMLButtonElement;
	let popup: HTMLDivElement;

	const menuItems = () => [...popup.querySelectorAll<HTMLElement>('[role="menuitem"]')];

	function show(focus: 'first' | 'last') {
		focusOnOpen = focus;
		open = true;
	}

	function close(returnFocus: boolean) {
		open = false;
		if (returnFocus) button.focus();
	}

	/** Below the trigger unless only above fits, then pulled back inside the viewport sideways. */
	function place() {
		popup.dataset.side = 'below';
		popup.style.translate = '';
		const rect = popup.getBoundingClientRect();
		const anchor = button.getBoundingClientRect();
		if (rect.bottom > window.innerHeight - MARGIN && anchor.top - rect.height - MARGIN >= 0) {
			popup.dataset.side = 'above';
		}
		const width = document.documentElement.clientWidth;
		let shift = 0;
		if (rect.right > width - MARGIN) shift = width - MARGIN - rect.right;
		if (rect.left + shift < MARGIN) shift = MARGIN - rect.left;
		if (shift !== 0) popup.style.translate = `${shift}px 0`;
	}

	$effect(() => {
		if (!open) return;

		place();
		const list = menuItems();
		(focusOnOpen === 'first' ? list[0] : list.at(-1))?.focus();

		// Capture, so the click that opened the menu has already passed the document by now.
		const onClick = (event: MouseEvent) => {
			if (root.contains(event.target as Node)) return;
			// Only when nothing else took the focus: a click on a field must stay in that field.
			const active = document.activeElement;
			close(!active || active === document.body || root.contains(active));
		};
		document.addEventListener('click', onClick, true);
		window.addEventListener('resize', place);
		return () => {
			document.removeEventListener('click', onClick, true);
			window.removeEventListener('resize', place);
		};
	});

	function onTriggerKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			show(event.key === 'ArrowDown' ? 'first' : 'last');
		} else if (event.key === 'Escape' && open) {
			event.preventDefault();
			close(true);
		}
	}

	function onMenuKeydown(event: KeyboardEvent) {
		const list = menuItems();
		const index = list.indexOf(document.activeElement as HTMLElement);
		const focusAt = (next: number) => list[(next + list.length) % list.length]?.focus();

		switch (event.key) {
			case 'ArrowDown':
				focusAt(index + 1);
				break;
			case 'ArrowUp':
				focusAt(index < 0 ? -1 : index - 1);
				break;
			case 'Home':
				focusAt(0);
				break;
			case 'End':
				focusAt(-1);
				break;
			case 'Escape':
				close(true);
				break;
			case 'Tab':
				// Back on the trigger first, so the browser's own move continues from there.
				close(true);
				return;
			default:
				return;
		}
		event.preventDefault();
	}

	/** The form stays mounted while hidden, so the post still goes out after the menu closes. */
	function submission(node: HTMLFormElement, item: PostItem) {
		const approved = () => !item.confirm || confirm(item.confirm);
		if (item.enhance) {
			return enhance(node, ({ cancel }) => {
				if (!approved()) cancel();
			});
		}
		const onSubmit = (event: SubmitEvent) => {
			if (!approved()) event.preventDefault();
		};
		node.addEventListener('submit', onSubmit);
		return { destroy: () => node.removeEventListener('submit', onSubmit) };
	}

	const ITEM =
		'flex w-full items-center px-3 py-2 text-left text-sm whitespace-nowrap outline-none hover:bg-surface-raised focus:bg-surface-raised';
</script>

<div bind:this={root} class="relative shrink-0">
	<button
		bind:this={button}
		type="button"
		id="{id}-trigger"
		class={triggerClass}
		aria-label={label}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls="{id}-menu"
		onclick={() => (open ? close(true) : show('first'))}
		onkeydown={onTriggerKeydown}
	>
		{@render trigger()}
	</button>

	<!-- The bg-bg underlay makes the translucent dark surface opaque over the page. -->
	<div
		bind:this={popup}
		hidden={!open}
		class="bg-bg absolute top-full right-0 z-20 mt-1 w-max max-w-[min(20rem,calc(100vw_-_1rem))] min-w-40 rounded-lg shadow-lg
			data-[side=above]:top-auto data-[side=above]:bottom-full data-[side=above]:mt-0 data-[side=above]:mb-1"
	>
		<div class="bg-surface border-border overflow-hidden rounded-lg border">
			{#if header}
				<div class="border-border text-text-muted truncate border-b px-3 py-2 text-xs">
					{@render header()}
				</div>
			{/if}
			<div
				role="menu"
				id="{id}-menu"
				aria-labelledby="{id}-trigger"
				tabindex="-1"
				class="py-1"
				onkeydown={onMenuKeydown}
			>
				{#each items as item (item.label)}
					{#if item.kind === 'link'}
						<a
							role="menuitem"
							tabindex="-1"
							href={item.href}
							class="{ITEM} text-text-subtle"
							onclick={() => close(false)}
						>
							{item.label}
						</a>
					{:else}
						<form method="POST" action={item.action} role="none" use:submission={item}>
							{#each Object.entries(item.fields ?? {}) as [name, value] (name)}
								<input type="hidden" {name} {value} />
							{/each}
							<button
								type="submit"
								role="menuitem"
								tabindex="-1"
								class="{ITEM} {item.danger ? 'text-danger' : 'text-text-subtle'}"
								onclick={() => close(true)}
							>
								{item.label}
							</button>
						</form>
					{/if}
				{/each}
			</div>
		</div>
	</div>
</div>
