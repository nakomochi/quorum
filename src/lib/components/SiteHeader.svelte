<script lang="ts">
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
		...(isAdmin ? [{ kind: 'link' as const, label: 'フォーム管理', href: '/admin/forms' }] : []),
		// The action lives on the top page; posting there works from any page.
		{ kind: 'post', label: 'ログアウト', action: '/?/logout' }
	]);
</script>

<header class="border-border border-b">
	<!-- Full width: the logo sits at the left edge and the controls at the right, whatever width
	     the page below uses for its content. -->
	<div class="flex items-center justify-between gap-4 px-6 py-3">
		<a href="/" class="min-w-0 truncate text-lg font-semibold hover:underline">form-discord</a>
		<div class="flex shrink-0 items-center gap-3">
			{#if member}
				<a href="/forms/new" class="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
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
							class="border-border-strong block size-8 rounded-full border"
						/>
					{:else}
						<span class="border-border-strong bg-surface-raised block size-8 rounded-full border"></span>
					{/if}
				{/snippet}
				{#snippet header()}
					<span class="text-text-subtle font-medium">{user.name}</span>
				{/snippet}
			</Menu>
		</div>
	</div>
</header>
