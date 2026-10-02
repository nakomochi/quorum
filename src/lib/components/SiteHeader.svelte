<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '$lib/icons/Icon.svelte';
	import Menu, { type MenuItem } from './Menu.svelte';

	type Props = {
		user: { name: string; image: string | null };
		member: boolean;
		isAdmin: boolean;
	};

	let { user, member, isAdmin }: Props = $props();

	// フォーム管理 is for a few people and rarely used, so it waits in the menu and keeps the header
	// on one line on a phone.
	const accountItems = $derived<MenuItem[]>([
		...(isAdmin
			? [{ kind: 'link' as const, label: 'フォーム管理', href: resolve('/admin/forms') }]
			: []),
		// The action lives on the top page; posting there works from any page.
		{ kind: 'post', label: 'ログアウト', action: '/?/logout' }
	]);
</script>

<header class="border-b border-border">
	<!-- Full width: the logo sits at the left edge and the controls at the right, whatever width
	     the page below uses for its content. -->
	<div class="flex items-center justify-between gap-4 px-6 py-3">
		<a href={resolve('/')} class="min-w-0 truncate text-lg font-semibold hover:underline">Quorum</a>
		<div class="flex shrink-0 items-center gap-3">
			{#if member}
				<a href={resolve('/forms/new')} class="btn-primary btn-sm inline-flex items-center gap-1.5">
					<Icon name="plus" />
					フォームを作る
				</a>
			{/if}
			<Menu
				label="アカウント: {user.name}"
				items={accountItems}
				triggerClass="focus-visible:ring-accent/60 block rounded-full outline-none focus-visible:ring-2"
			>
				{#snippet trigger()}
					{#if user.image}
						<img
							src={user.image}
							alt=""
							class="block size-8 rounded-full border border-border-strong"
						/>
					{:else}
						<span class="block size-8 rounded-full border border-border-strong bg-surface-raised"
						></span>
					{/if}
				{/snippet}
				{#snippet header()}
					<span class="font-medium text-text-subtle">{user.name}</span>
				{/snippet}
			</Menu>
		</div>
	</div>
</header>
