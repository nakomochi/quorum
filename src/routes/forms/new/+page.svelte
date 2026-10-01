<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import FormEditor from '$lib/form-editor/FormEditor.svelte';

	let { data, form } = $props();

	// Replaced, not pushed: a reload opens the draft again, and Back still leaves the editor.
	function trackDraft(id: string) {
		const url = new URL(page.url);
		url.searchParams.set('draft', id);
		replaceState(url, page.state);
	}
</script>

<FormEditor
	heading="フォームを作成"
	roles={data.roles}
	channels={data.channels}
	draft={data.draft}
	{form}
	submitLabel="作成する"
	conflictMessage="別の画面でこの下書きが更新されたか、作成・破棄されました。この画面の自動保存は停止しています。"
	ondraftcreated={trackDraft}
/>
