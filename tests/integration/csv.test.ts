import { describe, expect, test } from 'bun:test';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { OTHER_OPTION_ID } from '$lib/forms';
import type { CreateFormInput } from '$lib/server/forms';
import { load as resultsLoad } from '../../src/routes/forms/[id]/results/+page.server';
import { GET } from '../../src/routes/forms/[id]/results/csv/+server';
import { OTHER_ROLE, TARGET_ROLE } from '../helpers/discord';
import {
	createUsers,
	inputs,
	makeForm,
	member,
	seedGuild,
	sessionLocals,
	snowflake,
	submit,
	type TestUser
} from '../helpers/fixtures';

const DATE = '\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}';

const event = (who: TestUser, id: string) =>
	({
		locals: sessionLocals(who),
		params: { id },
		url: new URL(`http://forms.test/forms/${id}/results`)
	}) as never;

/** The status and message a request was refused with, or 'ok'. */
async function outcome(
	run: () => Promise<unknown>
): Promise<'ok' | { status: number; message: string }> {
	try {
		await run();
		return 'ok';
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, message: e.body.message };
		if (isRedirect(e)) return { status: e.status, message: e.location };
		throw e;
	}
}

/**
 * A creator outside the target, a target member who answers, one who only views, an outsider who
 * answers, and someone not in the guild at all.
 */
async function guild() {
	const [creator, answerer, viewer, outsider, stranger] = await createUsers(
		[1, 2, 3, 4, 5].map(snowflake)
	);
	await seedGuild([
		member(creator.discordId, [OTHER_ROLE], { nick: '作成者' }),
		member(answerer.discordId, [TARGET_ROLE], { nick: '答える人' }),
		member(viewer.discordId, [TARGET_ROLE], { nick: '見る人' }),
		member(outsider.discordId, [OTHER_ROLE], { nick: 'そと' })
	]);
	return { creator, answerer, viewer, outsider, stranger };
}

type Guild = Awaited<ReturnType<typeof guild>>;

/**
 * The outsider answers first. The question's label and the answers need quoting, and one answer
 * starts like a formula.
 */
async function answeredForm(
	{ creator, answerer, outsider }: Guild,
	overrides: Partial<CreateFormInput> = {}
) {
	const { id, questions } = await makeForm(creator, {
		questions: [
			{
				type: 'text',
				label: '名前, ふりがな',
				helpText: null,
				required: false,
				options: null,
				allowOther: false
			},
			{
				type: 'single',
				label: '参加',
				helpText: null,
				required: false,
				options: [
					{ id: 'yes', label: '出席' },
					{ id: 'no', label: '欠席' }
				],
				allowOther: true
			}
		],
		...overrides
	});
	await submit(id, outsider, [OTHER_ROLE], inputs(questions, { 0: 'a\nb' }));
	await submit(
		id,
		answerer,
		[TARGET_ROLE],
		inputs(questions, { 0: '=SUM(A1)', 1: { values: [OTHER_OPTION_ID], other: 'ほか"引用"' } })
	);
	return id;
}

async function download(who: TestUser, id: string) {
	const res = await GET(event(who, id));
	return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

describe('the results CSV', () => {
	test('the target’s responses, then the outsiders’, escaped for a spreadsheet', async () => {
		const people = await guild();
		const { creator, answerer, outsider } = people;
		const id = await answeredForm(people, { title: '春合宿' });

		const { res, bytes } = await download(creator, id);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('content-disposition')).toBe(
			`attachment; filename="responses.csv"; filename*=UTF-8''${encodeURIComponent('春合宿')}.csv`
		);
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

		const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
		const records = text.slice(1).split('\r\n');
		expect(records).toHaveLength(4);
		expect(records[0]).toBe('回答者,対象,提出日時,最終更新日時,"名前, ふりがな",参加');
		expect(records[1]).toMatch(
			new RegExp(`^答える人,対象,${DATE},${DATE},'=SUM\\(A1\\),"その他: ほか""引用"""$`)
		);
		expect(records[2]).toMatch(new RegExp(`^そと,対象外,${DATE},${DATE},"a\\nb",$`));
		expect(records[3]).toBe('');
		for (const who of [creator, answerer, outsider]) expect(text).not.toContain(who.discordId);
	});

	test('a member who may view the results gets it, not only the form’s managers', async () => {
		const people = await guild();
		const id = await answeredForm(people);

		const { res } = await download(people.viewer, id);

		expect(res.status).toBe(200);
	});

	test('whoever the results page refuses is refused the same way', async () => {
		const people = await guild();
		const { viewer, creator, stranger } = people;
		const adminOnly = await answeredForm(people, { visibility: 'admin_only' });
		const early = await answeredForm(people, {
			visibility: 'after_deadline',
			deadline: new Date(Date.now() + 86_400_000)
		});

		for (const id of [adminOnly, early]) {
			const page = await outcome(() => resultsLoad(event(viewer, id)));
			expect(page).not.toBe('ok');
			expect(await outcome(() => GET(event(viewer, id)))).toEqual(page);

			// A non-member, whatever the visibility.
			const outside = await outcome(() => GET(event(stranger, id)));
			expect(outside).toEqual({ status: 403, message: 'このサーバーのメンバーではありません' });
			expect(await outcome(() => resultsLoad(event(stranger, id)))).toEqual(outside);

			expect((await download(creator, id)).res.status).toBe(200);
		}
	});
});
