<script lang="ts">
	import { untrack } from 'svelte';
	import type { EditorState } from '$lib/form-draft';
	import { MAX_DESCRIPTION, MAX_TITLE } from '$lib/forms';
	import type { PageData } from './$types';

	type Props = {
		/**
		 * The restored draft's values, or null for a new form. The uncontrolled fields take them as
		 * defaultValue/defaultChecked: a value/checked attribute is written again whenever the
		 * template reruns, and after hydration that overwrites what has been typed.
		 */
		initial: EditorState | null;
		roles: PageData['roles'];
		channels: PageData['channels'];
		deadline: string;
		closesAt: string;
		/** Set once the admin types a closesAt of their own. */
		closesAtTouched: boolean;
	};

	let {
		initial,
		roles,
		channels,
		deadline = $bindable(),
		closesAt = $bindable(),
		closesAtTouched = $bindable()
	}: Props = $props();

	const ROLE_MISSING = '元のロールが見つかりません。選び直してください';
	const CHANNEL_MISSING = '元のチャンネルが見つかりません。選び直してください';

	// Controlled so that a stored id missing from today's options can be told apart from a choice.
	let targetRoleId = $state(untrack(() => initial?.targetRoleId ?? ''));
	let announcementChannelId = $state(untrack(() => initial?.announcementChannelId ?? ''));

	const roleMissing = $derived(
		targetRoleId !== '' && !roles.some((role) => role.id === targetRoleId)
	);
	const channelMissing = $derived(
		announcementChannelId !== '' && !channels.some((channel) => channel.id === announcementChannelId)
	);

	/** Blocks the submission, with the reason in the browser's own bubble, until it is resolved. */
	const validity = (message: () => string) => (node: HTMLSelectElement) => {
		node.setCustomValidity(message());
	};

	// closesAt defaults to the announced deadline until the admin types their own value.
	function onDeadlineInput(value: string) {
		deadline = value;
		if (!closesAtTouched) closesAt = value;
	}
</script>

<section class="card flex flex-col gap-4 p-5">
	<label class="block">
		<span class="text-sm font-medium">タイトル</span>
		<input
			name="title"
			defaultValue={initial?.title ?? ''}
			required
			maxlength={MAX_TITLE}
			class="field mt-1"
		/>
	</label>

	<label class="block">
		<span class="text-sm font-medium">説明</span>
		<textarea
			name="description"
			defaultValue={initial?.description ?? ''}
			rows="3"
			maxlength={MAX_DESCRIPTION}
			class="field mt-1"
		></textarea>
	</label>

	<div class="grid gap-4 sm:grid-cols-2">
		<label class="block">
			<span class="text-sm font-medium">対象ロール</span>
			<select
				name="targetRoleId"
				required
				bind:value={targetRoleId}
				{@attach validity(() => (roleMissing ? ROLE_MISSING : ''))}
				class="field mt-1"
			>
				{#if roleMissing}
					<!-- Keeps the stored id, so a reload shows the notice again instead of a default. -->
					<option value={targetRoleId} hidden>選択してください</option>
				{/if}
				<option value="">選択してください</option>
				{#each roles as role (role.id)}
					<option value={role.id}>{role.name}</option>
				{/each}
			</select>
			{#if roleMissing}
				<span class="mt-1 block text-xs text-warning">{ROLE_MISSING}</span>
			{/if}
		</label>

		<label class="block">
			<span class="text-sm font-medium">告知チャンネル</span>
			<!-- An empty value means no announcement, so a missing channel cannot fall back to it. -->
			<select
				name="announcementChannelId"
				bind:value={announcementChannelId}
				{@attach validity(() => (channelMissing ? CHANNEL_MISSING : ''))}
				class="field mt-1"
			>
				{#if channelMissing}
					<option value={announcementChannelId} hidden>選択してください</option>
				{/if}
				<option value="">告知しない</option>
				{#each channels as channel (channel.id)}
					<option value={channel.id}>#{channel.name}</option>
				{/each}
			</select>
			{#if channelMissing}
				<span class="mt-1 block text-xs text-warning">{CHANNEL_MISSING}</span>
			{/if}
		</label>

		<label class="block">
			<span class="text-sm font-medium">提出できる人</span>
			<select
				name="submitScope"
				defaultValue={initial?.submitScope ?? 'everyone'}
				class="field mt-1"
			>
				<option value="everyone">サーバーのメンバー全員</option>
				<option value="target_role">対象ロールの人のみ</option>
			</select>
		</label>

		<label class="block">
			<span class="text-sm font-medium">結果の公開範囲</span>
			<select name="visibility" defaultValue={initial?.visibility ?? 'public'} class="field mt-1">
				<option value="public">公開</option>
				<option value="admin_only">管理者のみ</option>
				<option value="after_deadline">締切後または確定後に公開</option>
			</select>
		</label>

		<label class="block">
			<span class="text-sm font-medium">締切（告知用）</span>
			<input
				type="datetime-local"
				name="deadline"
				value={deadline}
				oninput={(event) => onDeadlineInput(event.currentTarget.value)}
				class="field mt-1"
			/>
		</label>

		<label class="block">
			<span class="text-sm font-medium">受付終了</span>
			<input
				type="datetime-local"
				name="closesAt"
				bind:value={closesAt}
				oninput={() => (closesAtTouched = true)}
				class="field mt-1"
			/>
			<span class="mt-1 block text-xs text-text-muted">空欄なら自動では締め切りません。</span>
		</label>
	</div>

	<label class="flex items-center gap-2 text-sm">
		<input
			type="checkbox"
			name="allowEdit"
			defaultChecked={initial?.allowEdit ?? true}
			class="size-4"
		/>
		回答の編集を許可する
	</label>
</section>
