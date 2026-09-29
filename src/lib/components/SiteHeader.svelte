<script lang="ts">
	import Icon from '$lib/icons/Icon.svelte';

	type Props = {
		user: { name: string; image: string | null };
		member: boolean;
		isAdmin: boolean;
	};

	let { user, member, isAdmin }: Props = $props();
</script>

<header class="border-border border-b">
	<!-- Full width: the logo sits at the left edge and the controls at the right, whatever width
	     the page below uses for its content. -->
	<div
		class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-3 sm:flex-nowrap"
	>
		<a href="/" class="shrink-0 text-lg font-semibold hover:underline">form-discord</a>
		<!-- Wraps only on phones, and then as two groups so the avatar never parts from ログアウト.
		     Past that it must stay on one line so the display name truncates instead of shoving the
		     controls onto rows of their own. -->
		<div class="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
			{#if member || isAdmin}
				<div class="flex shrink-0 items-center gap-2">
					{#if member}
						<a
							href="/forms/new"
							class="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
						>
							<Icon name="plus" />
							フォームを作る
						</a>
					{/if}
					{#if isAdmin}
						<a href="/admin/forms" class="btn-secondary px-3 py-1.5 text-xs">フォーム管理</a>
					{/if}
				</div>
			{/if}
			<div class="flex min-w-0 items-center gap-2">
				{#if user.image}
					<img
						src={user.image}
						alt=""
						class="border-border-strong size-8 shrink-0 rounded-full border"
					/>
				{:else}
					<div class="border-border-strong bg-surface-raised size-8 shrink-0 rounded-full border"></div>
				{/if}
				<!-- Dropped on phones: the avatar already identifies the viewer, and keeping the name
				     pushes the controls past the viewport. -->
				<span class="hidden truncate text-sm sm:inline">{user.name}</span>
				<!-- The action lives on the top page; posting there works from any page. -->
				<form method="POST" action="/?/logout" class="shrink-0">
					<button type="submit" class="btn-secondary px-3 py-1.5 text-xs">ログアウト</button>
				</form>
			</div>
		</div>
	</div>
</header>
