<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import FieldError from '$lib/components/FieldError.svelte';
	import SearchSelect, { type SearchOption } from '$lib/components/SearchSelect.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import type { EditorState } from '$lib/form-draft';
	import {
		AUDIENCE_LOCKED,
		CHANNEL_LOCKED,
		MAX_DESCRIPTION,
		MAX_TITLE,
		NO_TARGET_ROLE,
		type FormField,
		type InputError
	} from '$lib/forms';
	import type { ChannelChoice, Choice, EditorLocks } from './editor';

	type Props = {
		/**
		 * The restored draft's values, or null for a new form. Read once into the fields' own state:
		 * that puts them in the server's HTML, and nothing but the field itself writes them again.
		 */
		initial: EditorState | null;
		roles: Choice[];
		channels: ChannelChoice[];
		locks: EditorLocks;
		/** The last submission's rejected input, drawn under the field it names. */
		inputError: InputError | null;
		deadline: string;
		closesAt: string;
		/** Set once the admin types a closesAt of their own. */
		closesAtTouched: boolean;
		/** Drawn under the deadline field, given its current value. */
		afterDeadline?: Snippet<[deadline: string]>;
	};

	let {
		initial,
		roles,
		channels,
		locks,
		inputError,
		deadline = $bindable(),
		closesAt = $bindable(),
		closesAtTouched = $bindable(),
		afterDeadline
	}: Props = $props();

	const ROLE_MISSING = '元のロールが見つかりません。選び直してください';
	const ROLE_UNCHOSEN = '対象ロールを一覧から選んでください';
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

	// "なし" first, then the roles in Discord's order.
	const roleOptions: SearchOption[] = $derived([
		{ value: NO_TARGET_ROLE, label: 'なし（サーバーの全員）' },
		...roles.map((role) => ({ value: role.id, label: role.name }))
	]);
	const channelOptions: SearchOption[] = $derived([
		{ value: '', label: '告知しない' },
		...channels.map((channel) => ({
			value: channel.id,
			label: `#${channel.name}`,
			hint: channel.category
		}))
	]);

	const noRole = $derived(targetRoleId === NO_TARGET_ROLE);
	const roleUnlisted = $derived(
		targetRoleId !== '' && !roleOptions.some((option) => option.value === targetRoleId)
	);
	const channelUnlisted = $derived(
		announcementChannelId !== '' &&
			!channels.some((channel) => channel.id === announcementChannelId)
	);
	// A locked setting keeps its stored id whatever Discord lists, so there is nothing to choose again.
	const roleMissing = $derived(roleUnlisted && !locks.audience);
	const channelMissing = $derived(channelUnlisted && !locks.channel);
	const noChannel = $derived(announcementChannelId === '');

	const roleInvalid = $derived(
		roleMissing ? ROLE_MISSING : targetRoleId === '' && !locks.audience ? ROLE_UNCHOSEN : ''
	);

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
		errorOf(name) ? { 'aria-invalid': true, 'aria-describedby': errorId(name) } : {};
</script>

<!-- Under the field it names, outside the label so that it is not read as part of the field's name. -->
{#snippet error(name: FormField)}
	<FieldError id={errorId(name)} message={errorOf(name)} class="mt-1" />
{/snippet}

<!-- A disabled field drops out of the form data, so a locked one is posted from a hidden field. The
     pickers post from one of their own whatever their state. -->
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
				class="field mt-1"></textarea>
		</label>
		{@render error('description')}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label for="targetRoleId-input" class="block text-sm font-medium">対象ロール</label>
			<!-- An id missing from the list keeps its value, so a reload shows the notice again. -->
			<SearchSelect
				id="targetRoleId-input"
				name="targetRoleId"
				bind:value={targetRoleId}
				options={roleOptions}
				placeholder="選択してください"
				disabled={locks.audience}
				invalidMessage={roleInvalid}
				{...described('targetRoleId')}
			/>
			{#if roleMissing}
				<span class="mt-1 block text-xs text-warning">{ROLE_MISSING}</span>
			{/if}
			{#if locks.audience}
				<span class="mt-1 block text-xs text-text-muted">{AUDIENCE_LOCKED}</span>
			{/if}
			{@render error('targetRoleId')}
		</div>

		<div>
			<label for="announcementChannelId-input" class="block text-sm font-medium"
				>告知チャンネル</label
			>
			<!-- An empty value means no announcement, so a missing channel cannot fall back to it. -->
			<SearchSelect
				id="announcementChannelId-input"
				name="announcementChannelId"
				bind:value={announcementChannelId}
				options={channelOptions}
				placeholder="選択してください"
				disabled={locks.channel}
				invalidMessage={channelMissing ? CHANNEL_MISSING : ''}
				{...described('announcementChannelId')}
			/>
			{#if channelMissing}
				<span class="mt-1 block text-xs text-warning">{CHANNEL_MISSING}</span>
			{/if}
			{#if locks.channel}
				<span class="mt-1 block text-xs text-text-muted">{CHANNEL_LOCKED}</span>
			{/if}
			{@render error('announcementChannelId')}
		</div>

		<!-- Without a role everyone may submit, and the server stores it so whatever is posted. -->
		{#if !noRole}
			<div>
				<label class="block">
					<span class="text-sm font-medium">提出できる人</span>
					<SelectField
						name={locks.audience ? undefined : 'submitScope'}
						disabled={locks.audience}
						bind:value={submitScope}
						{...described('submitScope')}
						class="mt-1"
					>
						<option value="everyone">サーバーのメンバー全員</option>
						<option value="target_role">対象ロールの人のみ</option>
					</SelectField>
					{#if locks.audience}
						{@render locked('submitScope', submitScope, AUDIENCE_LOCKED)}
					{/if}
				</label>
				{@render error('submitScope')}
			</div>
		{/if}

		<div>
			<label class="block">
				<span class="text-sm font-medium">結果の公開範囲</span>
				<SelectField
					name="visibility"
					bind:value={visibility}
					{...described('visibility')}
					class="mt-1"
				>
					<option value="public">公開</option>
					<option value="admin_only">管理者のみ</option>
					<option value="after_deadline">締切後または確定後に公開</option>
				</SelectField>
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
			{@render afterDeadline?.(deadline)}
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
				: noRole
					? '告知への返信として、誰もメンションせずに投稿します。'
					: '対象ロールをメンションして、告知への返信として投稿します。'}
		</span>
		<!-- Sent in the box's place: a disabled box drops out of the form data, choice and all. -->
		<input type="hidden" name="announceClose" value={announceClose ? 'on' : 'off'} />
	</div>
</section>
