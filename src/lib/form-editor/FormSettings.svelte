<script lang="ts">
	import { untrack } from 'svelte';
	import FieldError from '$lib/components/FieldError.svelte';
	import type { EditorState } from '$lib/form-draft';
	import {
		AUDIENCE_LOCKED,
		CHANNEL_LOCKED,
		MAX_DESCRIPTION,
		MAX_TITLE,
		type FormField,
		type InputError
	} from '$lib/forms';
	import type { Choice, EditorLocks } from './editor';

	type Props = {
		/**
		 * The restored draft's values, or null for a new form. Read once into the fields' own state:
		 * that puts them in the server's HTML, and nothing but the field itself writes them again.
		 */
		initial: EditorState | null;
		roles: Choice[];
		channels: Choice[];
		locks: EditorLocks;
		/** The last submission's rejected input, drawn under the field it names. */
		inputError: InputError | null;
		deadline: string;
		closesAt: string;
		/** Set once the admin types a closesAt of their own. */
		closesAtTouched: boolean;
	};

	let {
		initial,
		roles,
		channels,
		locks,
		inputError,
		deadline = $bindable(),
		closesAt = $bindable(),
		closesAtTouched = $bindable()
	}: Props = $props();

	const ROLE_MISSING = '元のロールが見つかりません。選び直してください';
	const CHANNEL_MISSING = '元のチャンネルが見つかりません。選び直してください';

	// Bound rather than given as defaultValue, which the server leaves out of its HTML. The title and
	// description stay out of the editor's undo history: `bind:value` writes the field only when the
	// state differs from it, so their native Ctrl+Z keeps working.
	let title = $state(untrack(() => initial?.title ?? ''));
	let description = $state(untrack(() => initial?.description ?? ''));
	let submitScope = $state(untrack(() => initial?.submitScope ?? 'everyone'));
	let visibility = $state(untrack(() => initial?.visibility ?? 'public'));
	let allowEdit = $state(untrack(() => initial?.allowEdit ?? true));
	let announceClose = $state(untrack(() => initial?.announceClose ?? true));

	// Controlled so that a stored id missing from today's options can be told apart from a choice.
	let targetRoleId = $state(untrack(() => initial?.targetRoleId ?? ''));
	let announcementChannelId = $state(untrack(() => initial?.announcementChannelId ?? ''));

	const roleUnlisted = $derived(
		targetRoleId !== '' && !roles.some((role) => role.id === targetRoleId)
	);
	const channelUnlisted = $derived(
		announcementChannelId !== '' && !channels.some((channel) => channel.id === announcementChannelId)
	);
	// A locked setting keeps its stored id whatever Discord lists, so there is nothing to choose again.
	const roleMissing = $derived(roleUnlisted && !locks.audience);
	const channelMissing = $derived(channelUnlisted && !locks.channel);
	const noChannel = $derived(announcementChannelId === '');

	/** Blocks the submission, with the reason in the browser's own bubble, until it is resolved. */
	const validity = (message: () => string) => (node: HTMLSelectElement) => {
		node.setCustomValidity(message());
	};

	// closesAt defaults to the announced deadline until the admin types their own value.
	function onDeadlineInput(value: string) {
		deadline = value;
		if (!closesAtTouched) closesAt = value;
	}

	const errorOf = (name: FormField) =>
		inputError?.at && 'field' in inputError.at && inputError.at.field === name
			? inputError.message
			: null;

	const errorId = (name: FormField) => `${name}-error`;

	/** Spread onto a field: marks it invalid and ties it to its message while it has one. */
	const described = (name: FormField) =>
		errorOf(name)
			? { 'aria-invalid': true, 'aria-describedby': errorId(name) }
			: {};
</script>

<!-- Under the field it names, outside the label so that it is not read as part of the field's name. -->
{#snippet error(name: FormField)}
	<FieldError id={errorId(name)} message={errorOf(name)} class="mt-1" />
{/snippet}

<!-- A disabled field drops out of the form data, so a locked one is posted from a hidden field. -->
{#snippet locked(name: FormField, value: string, note: string)}
	<input type="hidden" {name} {value} />
	<span class="mt-1 block text-xs text-text-muted">{note}</span>
{/snippet}

<section class="card flex flex-col gap-4 p-5">
	<div>
		<label class="block">
			<span class="text-sm font-medium">タイトル</span>
			<input
				name="title"
				bind:value={title}
				required
				maxlength={MAX_TITLE}
				{...described('title')}
				class="field mt-1"
			/>
		</label>
		{@render error('title')}
	</div>

	<div>
		<label class="block">
			<span class="text-sm font-medium">説明</span>
			<textarea
				name="description"
				bind:value={description}
				rows="3"
				maxlength={MAX_DESCRIPTION}
				{...described('description')}
				class="field mt-1"
			></textarea>
		</label>
		{@render error('description')}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label class="block">
				<span class="text-sm font-medium">対象ロール</span>
				<select
					name={locks.audience ? undefined : 'targetRoleId'}
					required
					disabled={locks.audience}
					bind:value={targetRoleId}
					{@attach validity(() => (roleMissing ? ROLE_MISSING : ''))}
					{...described('targetRoleId')}
					class="field mt-1"
				>
					{#if roleUnlisted}
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
				{#if locks.audience}
					{@render locked('targetRoleId', targetRoleId, AUDIENCE_LOCKED)}
				{/if}
			</label>
			{@render error('targetRoleId')}
		</div>

		<div>
			<label class="block">
				<span class="text-sm font-medium">告知チャンネル</span>
				<!-- An empty value means no announcement, so a missing channel cannot fall back to it. -->
				<select
					name={locks.channel ? undefined : 'announcementChannelId'}
					disabled={locks.channel}
					bind:value={announcementChannelId}
					{@attach validity(() => (channelMissing ? CHANNEL_MISSING : ''))}
					{...described('announcementChannelId')}
					class="field mt-1"
				>
					{#if channelUnlisted}
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
				{#if locks.channel}
					{@render locked('announcementChannelId', announcementChannelId, CHANNEL_LOCKED)}
				{/if}
			</label>
			{@render error('announcementChannelId')}
		</div>

		<div>
			<label class="block">
				<span class="text-sm font-medium">提出できる人</span>
				<select
					name={locks.audience ? undefined : 'submitScope'}
					disabled={locks.audience}
					bind:value={submitScope}
					{...described('submitScope')}
					class="field mt-1"
				>
					<option value="everyone">サーバーのメンバー全員</option>
					<option value="target_role">対象ロールの人のみ</option>
				</select>
				{#if locks.audience}
					{@render locked('submitScope', submitScope, AUDIENCE_LOCKED)}
				{/if}
			</label>
			{@render error('submitScope')}
		</div>

		<div>
			<label class="block">
				<span class="text-sm font-medium">結果の公開範囲</span>
				<select
					name="visibility"
					bind:value={visibility}
					{...described('visibility')}
					class="field mt-1"
				>
					<option value="public">公開</option>
					<option value="admin_only">管理者のみ</option>
					<option value="after_deadline">締切後または確定後に公開</option>
				</select>
			</label>
			{@render error('visibility')}
		</div>

		<div>
			<label class="block">
				<span class="text-sm font-medium">締切（告知用）</span>
				<input
					type="datetime-local"
					name="deadline"
					value={deadline}
					oninput={(event) => onDeadlineInput(event.currentTarget.value)}
					{...described('deadline')}
					class="field mt-1"
				/>
			</label>
			{@render error('deadline')}
		</div>

		<div>
			<label class="block">
				<span class="text-sm font-medium">受付終了</span>
				<input
					type="datetime-local"
					name="closesAt"
					bind:value={closesAt}
					oninput={() => (closesAtTouched = true)}
					{...described('closesAt')}
					class="field mt-1"
				/>
				<span class="mt-1 block text-xs text-text-muted">空欄なら自動では締め切りません。</span>
			</label>
			{@render error('closesAt')}
		</div>
	</div>

	<label class="flex items-center gap-2 text-sm">
		<input type="checkbox" name="allowEdit" bind:checked={allowEdit} class="size-4" />
		回答の編集を許可する
	</label>

	<div>
		<label class="flex items-center gap-2 text-sm" class:text-text-muted={noChannel}>
			<input
				type="checkbox"
				bind:checked={announceClose}
				disabled={noChannel}
				aria-describedby="announce-close-hint"
				class="size-4"
			/>
			締め切ったときに Discord に投稿する
		</label>
		<span id="announce-close-hint" class="mt-1 block pl-6 text-xs text-text-muted">
			{noChannel
				? '告知チャンネルを選ぶと設定できます。'
				: '対象ロールをメンションして、告知への返信として投稿します。'}
		</span>
		<!-- Sent in the box's place: a disabled box drops out of the form data, choice and all. -->
		<input type="hidden" name="announceClose" value={announceClose ? 'on' : 'off'} />
	</div>
</section>
