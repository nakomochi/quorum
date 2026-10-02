import { displayJst } from '$lib/display-date';
import type { MetaItem } from './MetaLine.svelte';

/** Lines the details up with the title in lists whose rows lead with a size-4 icon and gap-2. */
export const UNDER_ICON = 'pl-6';

export const deadlineItem = (value: Date | null): MetaItem =>
	value ? { label: '締切', value: displayJst(value) } : { value: '締切なし' };
