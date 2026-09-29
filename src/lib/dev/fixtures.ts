/**
 * Static fixtures for the dev-only UI catalogue at /dev/ui.
 *
 * Every shape is derived from the routes' generated `PageData`, so a load-function change that
 * the catalogue does not follow fails `bun run check` instead of silently drifting.
 * This module must never import `$lib/server`: it is shipped to the browser.
 */

import { tick } from 'svelte';
import { formatJst } from '../datetime';
import { hasOptions } from '../forms';
import type { ActionData as HomeAction, PageData as HomeData } from '../../routes/$types';
import type {
	ActionData as AnswerAction,
	PageData as AnswerData
} from '../../routes/forms/[id]/$types';
import type {
	ActionData as ResultsAction,
	PageData as ResultsData
} from '../../routes/forms/[id]/results/$types';
import type { PageData as HistoryData } from '../../routes/forms/[id]/results/[responseId]/$types';
import type { ActionData as NewAction, PageData as NewData } from '../../routes/forms/new/$types';
import type {
	ActionData as AdminAction,
	PageData as AdminData
} from '../../routes/admin/forms/$types';

/** How the catalogue answers draft saves, the editor's and the answer page's, in place of the server. */
export type DraftApiMode = 'ok' | 'hang' | 'fail' | 'conflict' | 'closed';

export type UiCase<Data, Form = null> = {
	id: string;
	title: string;
	data: Data;
	form?: Form;
	/** Drives the rendered page into a state that only interaction can reach. */
	setup?: (doc: Document) => Promise<void>;
	/** Defaults to 'ok'. */
	draftApi?: DraftApiMode;
};

/** Fixed so that the status line reads the same on every run. */
const DRAFT_SAVED_AT = new Date('2026-09-29T12:36:00+09:00');

export function draftApiResponse(mode: DraftApiMode, method: string): Promise<Response> {
	const json = (body: unknown, status: number) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	switch (mode) {
		case 'hang':
			return new Promise(() => {});
		case 'fail':
			return Promise.resolve(json({ message: 'catalogue stub' }, 500));
		case 'conflict':
		case 'closed':
			return Promise.resolve(json({ reason: mode }, 409));
		case 'ok':
			if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
			return Promise.resolve(
				json(
					{ id: 'fixturedraft', version: 4, updatedAt: DRAFT_SAVED_AT.toISOString() },
					method === 'POST' ? 201 : 200
				)
			);
	}
}

type SessionUser = NonNullable<HomeData['user']>;
type PendingRow = HomeData['pending'][number];
type SubmittedRow = HomeData['submitted'][number];
type CreatedRow = HomeData['created'][number];
type QuestionRow = AnswerData['questions'][number];
type ResultRow = ResultsData['submitted'][number];
type ResultQuestion = ResultsData['questions'][number];
type Tally = ResultsData['tallies'][number];
type ReminderEntry = ResultsData['reminders'][number];
type Revision = HistoryData['revisions'][number];
type HistoryQuestion = HistoryData['questions'][number];
type AdminRow = AdminData['forms'][number];

const at = (jst: string) => new Date(`${jst}+09:00`);

const HOUR_MS = 3_600_000;

const jstYear = () => new Date(Date.now() + 9 * HOUR_MS).getUTCFullYear();

/** Dates in the current JST year, which the pages show without the year, and in the one before. */
const thisYear = (monthDayTime: string) => at(`${jstYear()}-${monthDayTime}`);
const lastYear = (monthDayTime: string) => at(`${jstYear() - 1}-${monthDayTime}`);

/**
 * The home page derives its urgency chips from the clock, so those rows cannot be fixed dates.
 * Snapped to the hour: the server and the hydrating client then format the same string.
 */
const fromNow = (hours: number) =>
	new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS + hours * HOUR_MS);

const GUILD_ID = '900000000000000000';
const ROLE_ID = '900000000000000001';
const CHANNEL_ID = '900000000000000002';

/** Built the way the results page's load builds it. */
const discordMessage = (messageId: string) =>
	`https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${messageId}`;

const ANNOUNCED = { hasChannel: true, url: discordMessage('900000000000000003') };
const NOT_ANNOUNCED = { hasChannel: true, url: null };
const NO_CHANNEL = { hasChannel: false, url: null };

const USER: SessionUser = {
	name: 'なこもち',
	image: null
};

/**
 * What the root layout returns for the viewer, drawn by the shared header. Its `now` goes unread
 * here: the pages judge "this year" by the catalogue route's own root layout data.
 */
const SESSION = { user: USER, member: true, isAdmin: false, now: new Date() };
const ADMIN_SESSION = { ...SESSION, isAdmin: true };

const LONG_TITLE =
	'2026年度 春合宿の参加可否および宿泊プラン・交通手段・食事アレルギーに関する事前アンケート（回答期限厳守）';

const WIDE_ADMIN_TITLE =
	'2026年度 夏合宿（8/10〜8/17・長野県白馬村）の参加登録、宿泊プラン・部屋割り・交通手段・食事アレルギー・緊急連絡先に関する事前アンケート（締切厳守・全員回答必須）';

const WIDE_ADMIN_TITLE_2 =
	'【再提出のお願い】新歓イベント運営スタッフの担当希望調査：前回の回答が一部の不具合で保存されていなかったため、お手数ですが全員もう一度回答してください';

const LONG_DESCRIPTION = [
	'このアンケートは合宿の宿泊手配と貸切バスの座席割当のために使用します。',
	'キャンセル料が発生する日程を過ぎると変更できませんので、確定した内容を入力してください。',
	'不明点がある場合は運営チャンネルまでお問い合わせください。回答内容は運営メンバーのみが閲覧します。'
].join('\n');

// --- builders ---

const pendingRow = (over: Partial<PendingRow> & Pick<PendingRow, 'id' | 'title'>): PendingRow => ({
	deadline: at('2026-04-30T23:59:00'),
	...over
});

const submittedRow = (
	over: Partial<SubmittedRow> & Pick<SubmittedRow, 'id' | 'title' | 'submittedAt'>
): SubmittedRow => ({
	revisionCount: 1,
	...over
});

const createdRow = (over: Partial<CreatedRow> & Pick<CreatedRow, 'id' | 'title'>): CreatedRow => ({
	deadline: at('2026-04-30T23:59:00'),
	responseCount: 0,
	status: 'open',
	...over
});

const question = (
	over: Partial<QuestionRow> & Pick<QuestionRow, 'id' | 'label' | 'type'>
): QuestionRow => ({
	helpText: null,
	required: false,
	options: null,
	allowOther: false,
	...over
});

const QUESTIONS: QuestionRow[] = [
	question({
		id: 1,
		type: 'single',
		label: '参加できますか',
		required: true,
		helpText: '確定した予定でお答えください。',
		options: [
			{ id: 'yes', label: '参加する' },
			{ id: 'no', label: '参加しない' },
			{ id: 'maybe', label: '未定' }
		]
	}),
	question({
		id: 2,
		type: 'multi',
		label: '参加できる日',
		options: [
			{ id: 'd1', label: '5/2（土）' },
			{ id: 'd2', label: '5/3（日）' },
			{ id: 'd3', label: '5/4（月・祝）' }
		]
	}),
	question({
		id: 3,
		type: 'text',
		label: '連絡事項があれば書いてください',
		required: true,
		helpText: '食事のアレルギーなど。'
	}),
	question({ id: 4, type: 'date', label: '到着予定日' })
];

const OTHER_QUESTIONS: QuestionRow[] = QUESTIONS.map((q) =>
	hasOptions(q.type) ? { ...q, allowOther: true } : q
);

const MANY_OPTIONS = Array.from({ length: 14 }, (_, i) => ({
	id: `slot${i + 1}`,
	label: `${4 + Math.floor(i / 7)}月${(i % 7) * 4 + 2}日 集合 — 現地集合または貸切バス（新宿駅西口 7:30 発）`
}));

const OVERFLOW_QUESTIONS: QuestionRow[] = [
	question({
		id: 11,
		type: 'single',
		label:
			'参加を希望する日程を一つ選んでください。複数希望がある場合は、次の自由記述欄にすべての候補を優先順位つきで記入してください。',
		required: true,
		helpText:
			'いずれの日程も宿泊を伴います。キャンセル料は開催14日前から発生し、以降の変更はお受けできません。',
		options: MANY_OPTIONS
	}),
	question({
		id: 12,
		type: 'text',
		label: '希望日程の補足',
		helpText: 'ThisIsAnUnbreakableVeryLongTokenWithoutAnySpacesToProbeWrappingBehaviour1234567890'
	})
];

const NAMES = [
	'あおい',
	'いつき',
	'うみ',
	'えいた',
	'おとは',
	'かえで',
	'きりや',
	'くるみ',
	'けんと',
	'こはる',
	'さくら',
	'しおり',
	'すばる',
	'せな',
	'そら'
];

const member = (index: number): string =>
	NAMES[index % NAMES.length] + (index >= NAMES.length ? `${index}` : '');

const resultRow = (index: number, answers: ResultRow['answers']): ResultRow => {
	const day = String(10 + (index % 10)).padStart(2, '0');
	const submittedAt = at(`2026-09-${day}T21:0${index % 10}:00`);
	return {
		responseId: index + 1,
		displayName: member(index),
		submittedAt,
		updatedAt: submittedAt,
		revisionCount: 1,
		answers
	};
};

const edited = (row: ResultRow, updatedAt: Date, revisionCount: number): ResultRow => ({
	...row,
	updatedAt,
	revisionCount
});

const SUBMITTED: ResultRow[] = [
	resultRow(0, {
		1: { type: 'single', optionId: 'yes' },
		2: { type: 'multi', optionIds: ['d1', 'd2'] },
		3: { type: 'text', text: '甲殻類アレルギーがあります。' },
		4: { type: 'date', date: '2026-05-02' }
	}),
	resultRow(1, {
		1: { type: 'single', optionId: 'maybe' },
		2: { type: 'multi', optionIds: ['d3'] },
		3: { type: 'text', text: '仕事の都合次第です。\n決まり次第連絡します。' }
	}),
	resultRow(2, {
		1: { type: 'single', optionId: 'no' },
		3: { type: 'text', text: '今回は見送ります。' },
		4: { type: 'date', date: '2026-05-03' }
	})
];

const OUTSIDERS: ResultRow[] = [
	resultRow(9, {
		1: { type: 'single', optionId: 'yes' },
		2: { type: 'multi', optionIds: ['d1'] },
		3: { type: 'text', text: 'ロールは持っていませんが参加したいです。' }
	})
];

const EDITED_SUBMITTED: ResultRow[] = [
	edited(SUBMITTED[0], at('2026-09-14T08:15:00'), 3),
	SUBMITTED[1],
	edited(SUBMITTED[2], at('2026-09-12T23:48:00'), 2)
];

const EDITED_OUTSIDERS: ResultRow[] = [edited(OUTSIDERS[0], at('2026-09-20T07:30:00'), 2)];

const OTHER_SUBMITTED: ResultRow[] = [
	...SUBMITTED,
	resultRow(3, {
		1: { type: 'single', other: '2日目の夜から合流します' },
		2: { type: 'multi', optionIds: ['d2', 'd3'], other: '5/5（火）の午前まで' },
		3: { type: 'text', text: '特になし' }
	}),
	resultRow(4, {
		1: { type: 'single', optionId: 'yes' },
		2: { type: 'multi', optionIds: [], other: '日程が決まり次第連絡します' },
		3: { type: 'text', text: '車で行きます。' }
	})
];

const toResultQuestion = (q: QuestionRow): ResultQuestion => ({
	id: q.id,
	label: q.label,
	type: q.type,
	options: q.options
});

const RESULT_QUESTIONS: ResultQuestion[] = QUESTIONS.map(toResultQuestion);

const TALLIES: Tally[] = [
	{
		questionId: 1,
		label: '参加できますか',
		type: 'single',
		options: [
			{ id: 'yes', label: '参加する', count: 2 },
			{ id: 'no', label: '参加しない', count: 1 },
			{ id: 'maybe', label: '未定', count: 1 }
		],
		other: null
	},
	{
		questionId: 2,
		label: '参加できる日',
		type: 'multi',
		options: [
			{ id: 'd1', label: '5/2（土）', count: 2 },
			{ id: 'd2', label: '5/3（日）', count: 1 },
			{ id: 'd3', label: '5/4（月・祝）', count: 1 }
		],
		other: null
	}
];

const EMPTY_TALLIES: Tally[] = TALLIES.map((tally) => ({
	...tally,
	options: tally.options.map((option) => ({ ...option, count: 0 }))
}));

const OTHER_TALLIES: Tally[] = [
	{
		...TALLIES[0],
		options: [
			{ id: 'yes', label: '参加する', count: 2 },
			{ id: 'no', label: '参加しない', count: 1 },
			{ id: 'maybe', label: '未定', count: 1 }
		],
		other: 1
	},
	{
		...TALLIES[1],
		options: [
			{ id: 'd1', label: '5/2（土）', count: 1 },
			{ id: 'd2', label: '5/3（日）', count: 2 },
			{ id: 'd3', label: '5/4（月・祝）', count: 2 }
		],
		other: 2
	}
];

/** Same counting as the server's tally, so bars and table rows of a fixture always agree. */
const tallyOf = (questions: QuestionRow[], rows: ResultRow[]): Tally[] =>
	questions
		.filter((q) => hasOptions(q.type))
		.map((q) => {
			const values = rows.map((row) => row.answers[q.id]);
			const picked = values.flatMap((value) => {
				if (value?.type === 'single') return 'other' in value ? [] : [value.optionId];
				return value?.type === 'multi' ? value.optionIds : [];
			});
			const others = values.filter(
				(value) =>
					(value?.type === 'single' && 'other' in value) ||
					(value?.type === 'multi' && value.other !== undefined)
			).length;
			return {
				questionId: q.id,
				label: q.label,
				type: q.type,
				options: (q.options ?? []).map((option) => ({
					...option,
					count: picked.filter((id) => id === option.id).length
				})),
				other: q.allowOther ? others : null
			};
		});

const EDITED_TALLIES = tallyOf(QUESTIONS, [...EDITED_SUBMITTED, ...EDITED_OUTSIDERS]);

const WIDE_DAYS = Array.from({ length: 8 }, (_, i) => ({
	id: `day${i + 1}`,
	label: `8/${i + 10}（${'月火水木金土日'[i % 7]}）`
}));

const WIDE_ACTIVITIES = [
	'登山',
	'カヌー',
	'バーベキュー',
	'花火',
	'天体観測',
	'温泉めぐり',
	'ボードゲーム大会',
	'写真撮影会',
	'早朝ランニング',
	'地元の酒蔵見学'
].map((label, i) => ({ id: `act${i + 1}`, label }));

const WIDE_QUESTIONS: QuestionRow[] = [
	question({
		id: 21,
		type: 'single',
		label:
			'合宿当日の集合方法を一つ選んでください。貸切バスを利用する場合は、乗車地と到着予定時刻を後の自由記述の質問で必ず入力してください。',
		allowOther: true,
		options: [
			{ id: 'bus', label: '貸切バス（新宿駅西口 7:30 発）' },
			{ id: 'train', label: '電車で現地集合' },
			{ id: 'car', label: '自家用車' }
		]
	}),
	question({
		id: 22,
		type: 'multi',
		label:
			'参加できる日程をすべて選んでください。部分参加の場合も、参加できる日はすべて選択し、途中参加・途中離脱の時刻は備考欄に書いてください。',
		allowOther: true,
		options: WIDE_DAYS
	}),
	question({
		id: 23,
		type: 'text',
		label:
			'食事に関するアレルギーや配慮が必要な事項があれば、具体的な食材名と症状の程度をあわせて記入してください。該当しない場合は「なし」と記入してください。'
	}),
	question({ id: 24, type: 'date', label: '到着予定日' }),
	question({
		id: 25,
		type: 'single',
		label: '部屋割りの希望',
		allowOther: true,
		options: [
			{ id: 'same', label: '同学年と同室' },
			{ id: 'any', label: '誰とでもよい' },
			{ id: 'solo', label: '個室を希望（追加料金あり）' }
		]
	}),
	question({
		id: 26,
		type: 'multi',
		label: '参加したいアクティビティ（いくつでも）',
		options: WIDE_ACTIVITIES
	}),
	question({ id: 27, type: 'text', label: '交通手段の詳細（自家用車の場合は同乗者も）' }),
	question({
		id: 28,
		type: 'single',
		label: 'Tシャツのサイズ',
		options: ['S', 'M', 'L', 'XL'].map((size) => ({ id: size, label: size }))
	}),
	question({
		id: 29,
		type: 'text',
		label:
			'緊急連絡先（保護者など）の氏名と電話番号を記入してください。未成年の場合は保護者の同意を得たうえで、連絡がつきやすい時間帯もあわせて記入してください。'
	}),
	question({ id: 30, type: 'date', label: '出発予定日' }),
	question({
		id: 31,
		type: 'multi',
		label: '持参できる備品',
		allowOther: true,
		options: [
			{ id: 'tent', label: 'テント' },
			{ id: 'stove', label: 'バーナー' },
			{ id: 'light', label: 'ランタン' },
			{ id: 'cooler', label: 'クーラーボックス' }
		]
	}),
	question({ id: 32, type: 'text', label: '運営への要望・質問' })
];

const WIDE_LONG_TEXT = [
	'初日は午後に必修の講義があるため、新宿駅西口発の貸切バスには間に合いません。',
	'講義が終わりしだい特急で現地へ向かい、19時前後に合流する予定です。',
	'夕食の準備に人数が必要であれば、到着が遅れる前提で割り振っていただけると助かります。',
	'2日目以降は全日程参加できます。帰りは同じ方面の人と相乗りするので、帰路のバスの座席は不要です。',
	'なお、急な休講などで予定が変わった場合は、前日までに運営チャンネルで必ず連絡します。'
].join('\n');

const WIDE_SUBMITTED: ResultRow[] = [
	resultRow(0, {
		21: { type: 'single', optionId: 'bus' },
		22: { type: 'multi', optionIds: WIDE_DAYS.map((day) => day.id) },
		23: { type: 'text', text: 'なし' },
		24: { type: 'date', date: '2026-08-10' },
		25: { type: 'single', optionId: 'same' },
		26: { type: 'multi', optionIds: WIDE_ACTIVITIES.map((activity) => activity.id) },
		27: { type: 'text', text: '貸切バス' },
		28: { type: 'single', optionId: 'M' },
		29: { type: 'text', text: '母・あおい花子 090-0000-0001（平日18時以降）' },
		30: { type: 'date', date: '2026-08-17' },
		31: { type: 'multi', optionIds: ['tent', 'stove', 'light', 'cooler'] },
		32: { type: 'text', text: '特になし' }
	}),
	resultRow(1, {
		21: { type: 'single', other: '初日の夜に特急で合流（19時ごろ現地着）' },
		22: {
			type: 'multi',
			optionIds: ['day1', 'day2', 'day3', 'day4', 'day5', 'day6'],
			other: '8/16 は午前中のみ参加、昼食後に離脱します'
		},
		23: {
			type: 'text',
			text: '甲殻類（えび・かに）で蕁麻疹が出ます。\n少量の出汁なら問題ありませんが、揚げ油の共用は避けたいです。'
		},
		24: { type: 'date', date: '2026-08-10' },
		25: { type: 'single', other: '後輩と同室を希望します（同じ班のため）' },
		26: { type: 'multi', optionIds: ['act2', 'act3', 'act5', 'act6', 'act7', 'act8', 'act10'] },
		27: { type: 'text', text: WIDE_LONG_TEXT },
		28: { type: 'single', optionId: 'L' },
		29: { type: 'text', text: '父・いつき太郎 080-0000-0002\n日中は仕事のため、つながらない場合はSMSでお願いします。' },
		30: { type: 'date', date: '2026-08-16' },
		31: { type: 'multi', optionIds: ['light'], other: 'モバイルバッテリー（大容量）を3台' },
		32: { type: 'text', text: WIDE_LONG_TEXT }
	}),
	resultRow(2, {
		21: { type: 'single', optionId: 'car' },
		22: { type: 'multi', optionIds: ['day3', 'day4', 'day5'] },
		23: { type: 'text', text: 'なし' },
		25: { type: 'single', optionId: 'any' },
		26: { type: 'multi', optionIds: ['act1'] },
		27: { type: 'text', text: '自家用車（同乗: かえで、きりや）\n高速代は3人で割ります。' },
		28: { type: 'single', optionId: 'XL' },
		30: { type: 'date', date: '2026-08-14' }
	}),
	resultRow(3, {
		21: { type: 'single', optionId: 'train' },
		22: { type: 'multi', optionIds: [], other: 'まだ未定です。7月末までに連絡します' },
		23: { type: 'text', text: '乳製品が苦手です（アレルギーではありません）。' },
		25: { type: 'single', optionId: 'solo' },
		26: { type: 'multi', optionIds: [] },
		28: { type: 'single', optionId: 'S' },
		32: { type: 'text', text: '個室の追加料金を事前に教えてください。' }
	}),
	resultRow(4, {
		21: { type: 'single', optionId: 'bus' },
		22: { type: 'multi', optionIds: ['day1', 'day2'] },
		23: { type: 'text', text: 'そばアレルギー（重度）。エピペンを持参します。' },
		24: { type: 'date', date: '2026-08-10' },
		25: { type: 'single', optionId: 'same' },
		26: { type: 'multi', optionIds: ['act3', 'act4'] },
		27: { type: 'text', text: '貸切バス（帰りは電車）' },
		28: { type: 'single', optionId: 'M' },
		29: { type: 'text', text: '姉・おとは 070-0000-0004' },
		30: { type: 'date', date: '2026-08-11' },
		31: { type: 'multi', optionIds: ['cooler'] }
	})
];

const WIDE_OUTSIDERS: ResultRow[] = [
	resultRow(11, {
		21: { type: 'single', optionId: 'train' },
		22: { type: 'multi', optionIds: ['day4', 'day5', 'day6', 'day7', 'day8'] },
		23: { type: 'text', text: 'なし' },
		26: { type: 'multi', optionIds: ['act1', 'act2', 'act3', 'act4', 'act5', 'act6'] },
		28: { type: 'single', optionId: 'L' },
		32: {
			type: 'text',
			text: 'OBとして途中から見学に行きたいです。\n宿泊は不要なので、日帰りで参加できる日を教えてください。'
		}
	})
];

const NON_SUBMITTERS = [3, 4, 5].map(member);

const MANY_NON_SUBMITTERS = Array.from({ length: 42 }, (_, i) => member(i + 3));

// One to three digits and one to three messages, so that the columns can be seen to line up.
const reminderEntry = (
	id: number,
	kind: ReminderEntry['kind'],
	sentAt: string,
	targetCount: number,
	messageCount: number
): ReminderEntry => ({
	id,
	kind,
	sentAt: at(sentAt),
	targetCount,
	messageCount,
	url: messageCount > 0 ? discordMessage(`9000000000000001${String(id).padStart(2, '0')}`) : null
});

const REMINDERS: ReminderEntry[] = [
	reminderEntry(5, 'manual', '2026-04-29T21:15:00', 7, 1),
	reminderEntry(4, 'manual', '2026-04-28T19:00:00', 42, 1),
	reminderEntry(3, 'auto', '2026-04-27T09:00:00', 51, 2),
	reminderEntry(2, 'manual', '2026-04-20T12:30:00', 60, 2),
	reminderEntry(1, 'manual', '2026-04-14T08:00:00', 118, 3)
];

/** With the row an automatic reminder leaves when nobody was pending: nothing posted, no link. */
const REMINDERS_WITH_EMPTY: ReminderEntry[] = [
	reminderEntry(7, 'auto', '2026-04-29T23:59:00', 0, 0),
	reminderEntry(6, 'manual', '2026-04-29T22:30:00', 3, 1),
	...REMINDERS
];

// Relative for the same reason as `fromNow`: the page locks itself once closesAt passes, so a
// fixed date would lock every open case the day it went by.
const answerForm = (over: Partial<AnswerData['form']> = {}): AnswerData['form'] => ({
	id: 'fixtureform1',
	title: '春合宿の参加確認',
	description: '5月の合宿について、参加可否を教えてください。',
	deadline: fromNow(24 * 14),
	closesAt: fromNow(24 * 15),
	...over
});

const FILLED_ANSWERS: AnswerData['answers'] = {
	1: { type: 'single', optionId: 'yes' },
	2: { type: 'multi', optionIds: ['d1', 'd3'] },
	3: { type: 'text', text: '甲殻類アレルギーがあります。\n初日は21時ごろ合流します。' },
	4: { type: 'date', date: '2026-05-02' }
};

const OTHER_ANSWERS: AnswerData['answers'] = {
	1: { type: 'single', other: '2日目の夜から合流します' },
	2: { type: 'multi', optionIds: ['d2', 'd3'], other: '5/5（火）の午前まで' },
	3: { type: 'text', text: '特になし' }
};

/** No draft and no history to show: a single revision is the submitted answer itself. */
const NO_DRAFT: Pick<AnswerData, 'draft' | 'history'> = { draft: null, history: [] };

/** The answers of `FILLED_ANSWERS` half rewritten and not sent yet. */
const DRAFT_ANSWERS: NonNullable<AnswerData['draft']>['answers'] = {
	1: { type: 'single', optionId: 'maybe' },
	2: { type: 'multi', optionIds: ['d2'] },
	3: { type: 'text', text: '仕事の都合で、初日は夜から合流するかもしれません。' }
};

const RESTORED_DRAFT: Pick<AnswerData, 'draft' | 'history'> = {
	draft: { version: 3, updatedAt: at('2026-09-29T12:34:00'), answers: DRAFT_ANSWERS },
	history: []
};

// The viewer's own revisions, newest first. The newest is FILLED_ANSWERS, as submitted.
const OWN_HISTORY: AnswerData['history'] = [
	{ number: 3, createdAt: at('2026-04-14T08:15:00'), answers: FILLED_ANSWERS },
	{
		number: 2,
		createdAt: at('2026-04-13T09:05:00'),
		answers: {
			1: { type: 'single', optionId: 'yes' },
			2: { type: 'multi', optionIds: ['d1'] },
			3: { type: 'text', text: '仕事の都合次第です。' },
			4: { type: 'date', date: '2026-05-02' }
		}
	},
	{
		number: 1,
		createdAt: at('2026-04-12T21:40:00'),
		answers: {
			1: { type: 'single', optionId: 'maybe' },
			3: { type: 'text', text: '仕事の都合次第です。' }
		}
	}
];

/** Opens one of the page's menus the way a click does. `index` counts from the end when negative. */
const openMenu =
	(scope: 'header' | 'main', index = 0) =>
	async (doc: Document) => {
		const triggers = [...doc.querySelectorAll<HTMLButtonElement>(`${scope} [aria-haspopup="menu"]`)];
		triggers.at(index)?.click();
		await tick();
	};

/** Fills `QUESTIONS` in the rendered form, for a state where typed input has to survive. */
async function typeAnswers(doc: Document) {
	const pick = (selector: string) => {
		const choice = doc.querySelector<HTMLInputElement>(selector);
		if (!choice) return;
		choice.checked = true;
		choice.dispatchEvent(new Event('change', { bubbles: true }));
	};
	const type = (selector: string, value: string) => {
		const field = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
		if (!field) return;
		field.value = value;
		field.dispatchEvent(new Event('input', { bubbles: true }));
	};

	pick('input[name="q_1"][value="yes"]');
	pick('input[name="q_2"][value="d2"]');
	type('textarea[name="q_3"]', '初日は講義のため、21時ごろ合流します。');
	type('input[name="q_4"]', '2026-05-02');
	await tick();
}

/** Every check the browser makes beyond plain `required`. */
const CHECKED_QUESTIONS: QuestionRow[] = [
	question({
		id: 41,
		type: 'multi',
		label: '参加できる日',
		required: true,
		allowOther: true,
		options: [
			{ id: 'd1', label: '5/2（土）' },
			{ id: 'd2', label: '5/3（日）' },
			{ id: 'd3', label: '5/4（月・祝）' }
		]
	}),
	question({
		id: 42,
		type: 'single',
		label: '集合方法',
		allowOther: true,
		options: [
			{ id: 'bus', label: '貸切バス' },
			{ id: 'train', label: '電車で現地集合' }
		]
	}),
	question({ id: 43, type: 'text', label: '自己紹介', required: true })
];

const CHECKED_ANSWERS: AnswerData['answers'] = {
	41: { type: 'multi', optionIds: ['d2'] },
	42: { type: 'single', other: '友人の車で向かいます' },
	43: { type: 'text', text: '2年のあおいです。' }
};

const resultsForm = (over: Partial<ResultsData['form']> = {}): ResultsData['form'] => ({
	id: 'fixtureform1',
	title: '春合宿の参加確認',
	deadline: at('2026-04-30T23:59:00'),
	closesAt: at('2026-05-01T00:00:00'),
	visibility: 'public',
	closedAt: null,
	...over
});

/** What the load leaves out for someone who may only read the results. */
const viewerForm = () => resultsForm({ visibility: null });

const ROSTER_SYNCED_AT = at('2026-04-14T08:15:00');

/** A manager's view of an open form, for the cases that differ only in the roster's sync state. */
const rosterResults = (over: Partial<ResultsData> = {}): ResultsData => ({
	...SESSION,
	form: resultsForm(),
	closed: false,
	reopenClearsClosesAt: false,
	manage: true,
	roleDeleted: false,
	rosterSyncedAt: ROSTER_SYNCED_AT,
	announceFailed: false,
	announcement: ANNOUNCED,
	reminders: [],
	questions: RESULT_QUESTIONS,
	tallies: TALLIES,
	frozen: false,
	targetCount: 6,
	submitted: SUBMITTED,
	outsiders: [],
	nonSubmitters: NON_SUBMITTERS,
	...over
});

/** Without a mirror nobody can pass the membership check, so there are no responses either. */
const UNSYNCED_ROSTER: Partial<ResultsData> = {
	rosterSyncedAt: null,
	announcement: NOT_ANNOUNCED,
	tallies: EMPTY_TALLIES,
	targetCount: 0,
	submitted: [],
	nonSubmitters: []
};

const HOME_WITH_DRAFTS: HomeData = {
	...SESSION,
	pending: [pendingRow({ id: 'pending000001', title: '春合宿の参加確認', deadline: fromNow(30) })],
	submitted: [],
	created: [createdRow({ id: 'mine00000001', title: '春合宿の参加確認', responseCount: 12 })],
	drafts: [
		{ id: 'draft0000001', title: '秋合宿の参加確認', updatedAt: at('2026-09-29T12:34:00') },
		{ id: 'draft0000002', title: null, updatedAt: at('2026-09-28T21:05:00') },
		{ id: 'draft0000003', title: LONG_TITLE, updatedAt: at('2026-09-20T08:00:00') }
	]
};

const ADMIN_HOME: HomeData = {
	...ADMIN_SESSION,
	user: { ...USER, name: 'とてもながい表示名のサーバー運営アカウント' },
	pending: [pendingRow({ id: 'pending000001', title: '春合宿の参加確認' })],
	submitted: [],
	created: [createdRow({ id: 'mine00000001', title: '春合宿の参加確認', responseCount: 12 })],
	drafts: []
};

// --- cases ---

export const HOME_CASES: UiCase<HomeData, HomeAction>[] = [
	{
		id: 'home-anonymous',
		title: '未ログイン',
		data: {
			user: null,
			member: false,
			isAdmin: false,
			now: SESSION.now,
			pending: [],
			submitted: [],
			created: [],
			drafts: []
		}
	},
	{
		id: 'home-empty',
		title: 'メンバー / フォーム0件',
		data: { ...SESSION, pending: [], submitted: [], created: [], drafts: [] }
	},
	{
		id: 'home-member',
		title: 'メンバー / 全一覧（印のある行とない行・長いタイトル・作成フォームの各状態）',
		data: {
			...SESSION,
			pending: [
				pendingRow({ id: 'pending000001', title: '春合宿の参加確認', deadline: fromNow(-36) }),
				pendingRow({ id: 'pending000005', title: LONG_TITLE, deadline: fromNow(20) }),
				pendingRow({ id: 'pending000002', title: '新歓イベントの担当希望', deadline: fromNow(30) }),
				pendingRow({ id: 'pending000003', title: '定例会の出欠（10月）', deadline: fromNow(24 * 21) }),
				pendingRow({ id: 'pending000004', title: 'Tシャツのサイズ調査', deadline: null })
			],
			submitted: [
				submittedRow({
					id: 'done00000001',
					title: '夏合宿のふりかえり',
					submittedAt: at('2026-03-28T22:10:00'),
					revisionCount: 3
				}),
				submittedRow({
					id: 'done00000002',
					title: '定例会の出欠（8月）',
					submittedAt: at('2026-03-04T12:30:00')
				}),
				submittedRow({
					id: 'done00000003',
					title: LONG_TITLE,
					submittedAt: at('2026-02-11T09:05:00'),
					revisionCount: 2
				})
			],
			created: [
				createdRow({
					id: 'mine00000001',
					title: '春合宿の参加確認',
					responseCount: 12
				}),
				createdRow({
					id: 'mine00000003',
					title: '新歓イベントの担当希望',
					responseCount: 8,
					deadline: at('2026-09-29T18:00:00'),
					status: 'ended'
				}),
				createdRow({
					id: 'mine00000002',
					title: LONG_TITLE,
					responseCount: 3,
					deadline: null,
					status: 'closed'
				})
			],
			drafts: [
				{ id: 'draft0000001', title: '秋合宿の参加確認', updatedAt: at('2026-09-29T12:34:00') },
				{ id: 'draft0000002', title: null, updatedAt: at('2026-09-28T21:05:00') },
				{ id: 'draft0000003', title: LONG_TITLE, updatedAt: at('2026-09-20T08:00:00') }
			]
		}
	},
	{
		id: 'home-drafts',
		title: 'メンバー / 下書きあり（無題・長いタイトルを含む）',
		data: HOME_WITH_DRAFTS
	},
	{
		id: 'home-long-lists',
		title: 'メンバー / 提出済みと作成済みが多い',
		data: {
			...SESSION,
			pending: [pendingRow({ id: 'pending000001', title: '春合宿の参加確認', deadline: fromNow(30) })],
			submitted: Array.from({ length: 9 }, (_, i) =>
				submittedRow({
					id: `done0000000${i + 1}`,
					title: `定例会の出欠（第 ${i + 1} 回）`,
					submittedAt: fromNow(-24 * 7 * (i + 1) - 30),
					revisionCount: i % 3 === 0 ? 2 : 1
				})
			),
			created: Array.from({ length: 6 }, (_, i) =>
				createdRow({
					id: `mine0000000${i + 1}`,
					title: `イベントの出欠確認 ${i + 1}`,
					responseCount: 20 - i * 3,
					deadline: fromNow(-24 * 10 * (i + 1)),
					status: i === 0 ? 'ended' : 'closed'
				})
			),
			drafts: []
		}
	},
	{
		id: 'home-mixed-years',
		title: 'メンバー / 今年と去年の日付が混ざる（去年の日付だけ年つき）',
		data: {
			...SESSION,
			pending: [pendingRow({ id: 'pending000001', title: '定例会の出欠（10月）', deadline: fromNow(24 * 21) })],
			submitted: [
				submittedRow({
					id: 'done00000001',
					title: '新年会の出欠',
					submittedAt: thisYear('01-08T22:10:00')
				}),
				submittedRow({
					id: 'done00000002',
					title: '忘年会の出欠',
					submittedAt: lastYear('12-04T12:30:00'),
					revisionCount: 2
				})
			],
			created: [
				createdRow({
					id: 'mine00000001',
					title: '年末大掃除の担当希望',
					responseCount: 24,
					deadline: lastYear('12-20T18:00:00'),
					status: 'closed'
				})
			],
			drafts: [{ id: 'draft0000001', title: '秋合宿の参加確認', updatedAt: lastYear('11-30T08:00:00') }]
		}
	},
	{
		id: 'home-outsider',
		title: '非メンバー',
		data: { ...SESSION, member: false, pending: [], submitted: [], created: [], drafts: [] }
	},
	{
		id: 'home-drafts-menu',
		title: 'メンバー / 下書きのメニューを開いた（破棄）',
		data: HOME_WITH_DRAFTS,
		setup: openMenu('main', 0)
	},
	{
		id: 'home-created-menu',
		title: 'メンバー / 作成したフォームのメニューを開いた（複製）',
		data: HOME_WITH_DRAFTS,
		setup: openMenu('main', -1)
	},
	{
		id: 'home-account-menu',
		title: 'メンバー / アバターのメニューを開いた（ログアウト）',
		data: HOME_WITH_DRAFTS,
		setup: openMenu('header')
	},
	{
		id: 'home-admin',
		title: '運営（フォーム管理はアバターのメニュー）',
		data: ADMIN_HOME
	},
	{
		id: 'home-admin-menu',
		title: '運営 / アバターのメニューを開いた（長い表示名・フォーム管理）',
		data: ADMIN_HOME,
		setup: openMenu('header')
	}
];

export const ANSWER_CASES: UiCase<AnswerData, AnswerAction>[] = [
	{
		id: 'answer-fresh',
		title: '未提出（新規回答）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		}
	},
	{
		id: 'answer-manager-private',
		title: '作成者・管理者 / 結果を一般に見せないフォーム（「回答状況を見る」を管理の枠に入れる）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: true,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		}
	},
	{
		id: 'answer-manager-private-long-title',
		title: '作成者・管理者 / 管理の枠と、折り返す長いタイトルに印が2つ',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: true,
			form: answerForm({ title: LONG_TITLE, closesAt: at('2026-04-20T23:59:00') }),
			questions: QUESTIONS,
			closed: true,
			editable: false,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-12T21:40:00'),
			answers: FILLED_ANSWERS,
			...NO_DRAFT
		}
	},
	{
		id: 'answer-other',
		title: '回答中（その他あり）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: OTHER_QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		}
	},
	{
		// The action result is what tells a first submission from an update, so `form` carries it.
		id: 'answer-created',
		title: '送信直後',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: OTHER_QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-12T21:40:00'),
			answers: OTHER_ANSWERS,
			...NO_DRAFT
		},
		form: { created: true }
	},
	{
		id: 'answer-updated',
		title: '更新直後',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-14T08:15:00'),
			answers: FILLED_ANSWERS,
			...NO_DRAFT
		},
		form: { created: false }
	},
	{
		id: 'answer-submitted',
		title: '後から開いた提出済み（編集可）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-12T21:40:00'),
			answers: FILLED_ANSWERS,
			...NO_DRAFT
		}
	},
	{
		id: 'answer-readonly',
		title: '提出済み / 編集不可',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: false,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-12T21:40:00'),
			answers: FILLED_ANSWERS,
			...NO_DRAFT
		}
	},
	{
		id: 'answer-closed-submitted',
		title: '受付終了（提出済み・タイトル行に印が2つ）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm({ closesAt: at('2026-04-20T23:59:00') }),
			questions: OTHER_QUESTIONS,
			closed: true,
			editable: false,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-12T21:40:00'),
			answers: OTHER_ANSWERS,
			...NO_DRAFT
		}
	},
	{
		id: 'answer-closed-long-title',
		title: '受付終了（提出済み・折り返す長いタイトルと印が2つ）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm({ title: LONG_TITLE, closesAt: at('2026-04-20T23:59:00') }),
			questions: QUESTIONS,
			closed: true,
			editable: false,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-14T08:15:00'),
			answers: FILLED_ANSWERS,
			...NO_DRAFT
		}
	},
	{
		id: 'answer-last-year',
		title: '去年のフォーム（年つきの日付・折り返す日付の行・長いタイトルと印が2つ・回答履歴）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm({
				title: LONG_TITLE,
				deadline: lastYear('10-14T04:00:00'),
				closesAt: lastYear('10-15T12:00:00')
			}),
			questions: QUESTIONS,
			closed: true,
			editable: false,
			submittedAt: lastYear('10-12T21:40:00'),
			updatedAt: lastYear('10-14T03:15:00'),
			answers: FILLED_ANSWERS,
			draft: null,
			history: OWN_HISTORY.map((revision, index) => ({
				...revision,
				createdAt: lastYear(['10-14T03:15:00', '10-13T09:05:00', '10-12T21:40:00'][index])
			}))
		}
	},
	{
		id: 'answer-closed',
		title: '受付終了（未提出）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm({ closesAt: at('2026-04-20T23:59:00') }),
			questions: QUESTIONS,
			closed: true,
			editable: false,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		}
	},
	{
		id: 'answer-error',
		title: '入力エラー（サーバーの検証で拒否）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		},
		// Only an input error the browser cannot catch belongs here: a choice sent by a stale page.
		form: { message: '「参加できますか」の選択肢が不正です' },
		setup: typeAnswers
	},
	{
		// The load said open, and closesAt has passed since: the page's own timer locks it.
		id: 'answer-expired',
		title: '回答中に受付終了日時を過ぎた（入力あり・送信不可）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm({ closesAt: fromNow(-1) }),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		},
		setup: typeAnswers
	},
	{
		// After the reload that follows the refusal: the data says closed, the form stays.
		id: 'answer-refused-closed',
		title: '送信したら受付終了していた（未提出・入力あり）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm({ closesAt: null }),
			questions: QUESTIONS,
			closed: true,
			editable: false,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		},
		form: { reason: 'closed' },
		setup: typeAnswers
	},
	{
		id: 'answer-edit-closed',
		title: '編集を保存したら受付終了していた（入力あり）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm({ closesAt: null }),
			questions: OTHER_QUESTIONS,
			closed: true,
			editable: false,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-12T21:40:00'),
			answers: OTHER_ANSWERS,
			...NO_DRAFT
		},
		form: { reason: 'closed' }
	},
	{
		// Opened before another tab submitted, then sent: the reload shows the other tab's answer.
		id: 'answer-already-submitted',
		title: '送信したら別の画面で提出済みだった（編集不可）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: false,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-12T21:40:00'),
			answers: FILLED_ANSWERS,
			...NO_DRAFT
		},
		form: { reason: 'already_submitted' }
	},
	{
		id: 'answer-checks',
		title: 'ブラウザの入力チェック（必須の複数選択・その他・必須の自由記述）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: CHECKED_QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		}
	},
	{
		id: 'answer-checks-restored',
		title: 'ブラウザの入力チェック（前回の回答を編集中）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: CHECKED_QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-12T21:40:00'),
			answers: CHECKED_ANSWERS,
			...NO_DRAFT
		},
		setup: async (doc) => {
			[...doc.querySelectorAll('button')]
				.find((b) => b.textContent?.trim() === '回答を編集')
				?.click();
			await tick();
		}
	},
	{
		id: 'answer-draft-restored',
		title: '下書きを復元した（未提出）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...RESTORED_DRAFT
		}
	},
	{
		id: 'answer-draft-unsent',
		title: '未送信の変更がある（提出済み）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-12T21:40:00'),
			answers: FILLED_ANSWERS,
			...RESTORED_DRAFT
		}
	},
	{
		id: 'answer-draft-saving',
		title: '下書きの自動保存中（入力の直後から）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		},
		setup: typeAnswers,
		draftApi: 'hang'
	},
	{
		id: 'answer-draft-saved',
		title: '下書きの自動保存が完了（入力の直後から）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		},
		setup: typeAnswers
	},
	{
		id: 'answer-draft-failed',
		title: '下書きの自動保存に失敗（入力の直後から）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...RESTORED_DRAFT
		},
		setup: typeAnswers,
		draftApi: 'fail'
	},
	{
		id: 'answer-draft-conflict',
		title: '別の画面で送信・更新されていた（409・入力の直後から）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...RESTORED_DRAFT
		},
		setup: typeAnswers,
		draftApi: 'conflict'
	},
	{
		id: 'answer-draft-closed',
		title: '下書きの保存で受付終了がわかった（409・入力の直後から）',
		data: {
			...SESSION,
			resultsVisible: false,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		},
		setup: typeAnswers,
		draftApi: 'closed'
	},
	{
		id: 'answer-history',
		title: '回答履歴あり（3版・最新／初回提出の印のある版とない版・読み込みボタン）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-14T08:15:00'),
			answers: FILLED_ANSWERS,
			draft: null,
			history: OWN_HISTORY
		}
	},
	{
		id: 'answer-history-readonly',
		title: '回答履歴あり / 受付終了（読み込み不可）',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm({ closesAt: at('2026-04-20T23:59:00') }),
			questions: QUESTIONS,
			closed: true,
			editable: false,
			submittedAt: at('2026-04-12T21:40:00'),
			updatedAt: at('2026-04-14T08:15:00'),
			answers: FILLED_ANSWERS,
			draft: null,
			history: OWN_HISTORY
		}
	},
	{
		id: 'answer-overflow',
		title: '長文タイトル / 選択肢14個',
		data: {
			...SESSION,
			resultsVisible: true,
			resultsManagersOnly: false,
			form: answerForm({ title: LONG_TITLE, description: LONG_DESCRIPTION, deadline: null }),
			questions: OVERFLOW_QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			updatedAt: null,
			answers: {},
			...NO_DRAFT
		}
	}
];

export const RESULTS_CASES: UiCase<ResultsData, ResultsAction>[] = [
	{
		id: 'results-viewer',
		title: '一般閲覧（manage: false・管理パネルなし）',
		data: {
			...SESSION,
			form: viewerForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: false,
			roleDeleted: false,
			rosterSyncedAt: null,
			announceFailed: false,
			announcement: null,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 6,
			submitted: SUBMITTED,
			outsiders: [],
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-manager',
		title: '管理者（管理パネル: 受付中・告知済み）',
		data: {
			...SESSION,
			form: resultsForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 6,
			submitted: SUBMITTED,
			outsiders: [],
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-edited-manager',
		title: '編集済みの回答あり / 管理者（更新日時の後ろに履歴へのリンク）',
		data: {
			...SESSION,
			form: resultsForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: EDITED_TALLIES,
			frozen: false,
			targetCount: 6,
			submitted: EDITED_SUBMITTED,
			outsiders: EDITED_OUTSIDERS,
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-edited-viewer',
		title: '編集済みの回答あり / 一般閲覧（更新日時の後ろに印・リンクなし）',
		data: {
			...SESSION,
			form: viewerForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: false,
			roleDeleted: false,
			rosterSyncedAt: null,
			announceFailed: false,
			announcement: null,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: EDITED_TALLIES,
			frozen: false,
			targetCount: 6,
			submitted: EDITED_SUBMITTED,
			outsiders: EDITED_OUTSIDERS,
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-many-pending',
		title: '未提出者が多数',
		data: {
			...SESSION,
			form: resultsForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 45,
			submitted: SUBMITTED,
			outsiders: [],
			nonSubmitters: MANY_NON_SUBMITTERS
		}
	},
	{
		id: 'results-outsiders',
		title: '対象外からの回答あり',
		data: {
			...SESSION,
			form: resultsForm({ visibility: 'after_deadline' }),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 6,
			submitted: SUBMITTED,
			outsiders: OUTSIDERS,
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-closed',
		title: '確定済み（管理パネル: 再開ボタン・名簿の更新なし / 凍結表示・リマインド不可）',
		data: {
			...SESSION,
			form: resultsForm({ closedAt: at('2026-05-01T00:05:00') }),
			closed: true,
			reopenClearsClosesAt: true,
			manage: true,
			roleDeleted: false,
			// A frozen roster does not depend on the mirror, so the load leaves these out.
			rosterSyncedAt: null,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: REMINDERS,
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: true,
			targetCount: 6,
			submitted: SUBMITTED,
			outsiders: OUTSIDERS,
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-last-year',
		title: '去年に確定したフォーム（年つきの日付・折り返す日付の行）',
		data: rosterResults({
			form: resultsForm({
				title: LONG_TITLE,
				deadline: lastYear('10-14T04:00:00'),
				closesAt: lastYear('10-15T12:00:00'),
				visibility: 'after_deadline',
				closedAt: lastYear('10-15T12:00:00')
			}),
			closed: true,
			reopenClearsClosesAt: true,
			rosterSyncedAt: null,
			reminders: [
				{ ...REMINDERS[0], sentAt: lastYear('10-13T21:15:00') },
				{ ...REMINDERS[2], sentAt: lastYear('10-13T04:00:00') }
			],
			frozen: true,
			tallies: tallyOf(QUESTIONS, EDITED_SUBMITTED),
			submitted: EDITED_SUBMITTED.map((row, index) => {
				const submittedAt = lastYear(`10-0${index + 1}T21:00:00`);
				const updatedAt = row.revisionCount > 1 ? lastYear('10-12T08:15:00') : submittedAt;
				return { ...row, submittedAt, updatedAt };
			})
		})
	},
	{
		id: 'results-expired',
		title: '受付終了日時を過ぎた / 自動で確定する前',
		data: {
			...SESSION,
			form: resultsForm(),
			closed: true,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: NOT_ANNOUNCED,
			reminders: REMINDERS,
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 6,
			submitted: SUBMITTED,
			outsiders: [],
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-reminders',
		title: 'リマインド送信履歴あり',
		data: {
			...SESSION,
			form: resultsForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: REMINDERS,
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 45,
			submitted: SUBMITTED,
			outsiders: [],
			nonSubmitters: MANY_NON_SUBMITTERS
		},
		form: { reminded: { targets: 42, messages: 1 } }
	},
	{
		id: 'results-reminded-split',
		title: 'リマインド送信直後（2通以上に分けて送信）',
		data: rosterResults({
			reminders: REMINDERS,
			targetCount: 121,
			nonSubmitters: Array.from({ length: 118 }, (_, i) => member(i + 3))
		}),
		form: { reminded: { targets: 118, messages: 3 } }
	},
	{
		id: 'results-closed-now',
		title: '「締め切って確定する」の直後',
		data: rosterResults({
			form: resultsForm({ closedAt: at('2026-04-29T22:00:00') }),
			closed: true,
			// A frozen roster does not depend on the mirror, so the load leaves this out.
			rosterSyncedAt: null,
			frozen: true
		}),
		form: { closed: 3 }
	},
	{
		id: 'results-closed-now-none',
		title: '「締め切って確定する」の直後（未提出者0名）',
		data: rosterResults({
			form: resultsForm({ closedAt: at('2026-04-29T22:00:00') }),
			closed: true,
			rosterSyncedAt: null,
			frozen: true,
			targetCount: SUBMITTED.length,
			nonSubmitters: []
		}),
		form: { closed: 0 }
	},
	{
		id: 'results-reopened',
		title: '「受付を再開する」の直後',
		data: rosterResults({ reminders: REMINDERS }),
		form: { reopened: true }
	},
	{
		id: 'results-reminder-links',
		title: '送信履歴の Discord へのリンク（投稿のない行はリンクなし）',
		data: rosterResults({ reminders: REMINDERS_WITH_EMPTY })
	},
	{
		id: 'results-empty',
		title: '回答者0名',
		data: {
			...SESSION,
			form: resultsForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: EMPTY_TALLIES,
			frozen: false,
			targetCount: 3,
			submitted: [],
			outsiders: [],
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-no-channel',
		title: '告知チャンネル未設定',
		data: {
			...SESSION,
			form: resultsForm({ title: LONG_TITLE }),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: NO_CHANNEL,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 6,
			submitted: SUBMITTED,
			outsiders: [],
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-announce-failed',
		title: '告知失敗（未投稿）',
		data: {
			...SESSION,
			form: resultsForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: true,
			announcement: NOT_ANNOUNCED,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 6,
			submitted: SUBMITTED,
			outsiders: [],
			nonSubmitters: NON_SUBMITTERS
		}
	},
	{
		id: 'results-not-announced',
		title: '管理者（管理パネル: 告知未投稿・「告知を投稿する」とリマインドの両方）',
		data: rosterResults({ announcement: NOT_ANNOUNCED, reminders: REMINDERS.slice(0, 2) })
	},
	{
		id: 'results-other',
		title: '「その他」の集計あり',
		data: {
			...SESSION,
			form: resultsForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: OTHER_TALLIES,
			frozen: false,
			targetCount: 8,
			submitted: OTHER_SUBMITTED,
			outsiders: [],
			nonSubmitters: [5, 6, 7].map(member)
		}
	},
	{
		// With the role gone nobody is in the roster, so every response counts as an outsider's.
		id: 'results-role-deleted',
		title: '対象ロールが削除済み',
		data: {
			...SESSION,
			form: resultsForm(),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: true,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 0,
			submitted: [],
			outsiders: SUBMITTED,
			nonSubmitters: []
		},
		form: { message: '対象ロールを持つメンバーがいないため、リマインドは送信していません' }
	},
	{
		id: 'results-wide',
		title: '横に長い回答表（質問12件・長い質問文・長い回答・その他・多数選択）',
		data: {
			...SESSION,
			form: resultsForm({ title: '夏合宿（8/10〜8/17）の参加登録と事前アンケート' }),
			closed: false,
			reopenClearsClosesAt: false,
			manage: true,
			roleDeleted: false,
			rosterSyncedAt: ROSTER_SYNCED_AT,
			announceFailed: false,
			announcement: ANNOUNCED,
			reminders: [],
			questions: WIDE_QUESTIONS.map(toResultQuestion),
			tallies: tallyOf(WIDE_QUESTIONS, [...WIDE_SUBMITTED, ...WIDE_OUTSIDERS]),
			frozen: false,
			targetCount: 8,
			submitted: WIDE_SUBMITTED,
			outsiders: WIDE_OUTSIDERS,
			nonSubmitters: [5, 6, 7].map(member)
		}
	},
	{
		id: 'results-roster-refreshed',
		title: '「名簿を更新」が成功',
		data: rosterResults(),
		form: { rosterSynced: true }
	},
	{
		id: 'results-roster-syncing',
		title: '「名簿を更新」の送信中（ボタン無効）',
		data: rosterResults(),
		setup: async (doc) => {
			// A synthetic submit runs the handler without navigating.
			doc
				.querySelector('form[action="?/syncRoster"]')
				?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
			await tick();
		}
	},
	{
		id: 'results-roster-refresh-failed',
		title: '「名簿を更新」が失敗（前回の名簿のまま）',
		data: rosterResults(),
		form: {
			message: `Discord からメンバー一覧を取得できませんでした。未提出者は前回（${formatJst(ROSTER_SYNCED_AT)}）の名簿のままです。`
		}
	},
	{
		id: 'results-roster-unsynced',
		title: '名簿が未同期（管理者）',
		data: rosterResults(UNSYNCED_ROSTER)
	},
	{
		id: 'results-roster-unsynced-failed',
		title: '名簿が未同期 / 「名簿を更新」も失敗',
		data: rosterResults(UNSYNCED_ROSTER),
		form: {
			message:
				'Discord からメンバー一覧を取得できませんでした。名簿がまだ一度も同期されていないため、未提出者を表示できません。'
		}
	}
];

const toHistoryQuestion = ({ id, label, options }: QuestionRow): HistoryQuestion => ({
	id,
	label,
	options
});

// Each revision changes different questions: 1 and 4, then 2 and 3.
const THREE_REVISIONS: Revision[] = [
	{
		number: 3,
		createdAt: at('2026-04-14T08:15:00'),
		answers: {
			1: { type: 'single', optionId: 'yes' },
			2: { type: 'multi', optionIds: ['d1', 'd2'] },
			3: { type: 'text', text: '甲殻類アレルギーがあります。\n初日は21時ごろ合流します。' },
			4: { type: 'date', date: '2026-05-02' }
		}
	},
	{
		number: 2,
		createdAt: at('2026-04-13T09:05:00'),
		answers: {
			1: { type: 'single', optionId: 'yes' },
			2: { type: 'multi', optionIds: ['d1'] },
			3: { type: 'text', text: '仕事の都合次第です。' },
			4: { type: 'date', date: '2026-05-02' }
		}
	},
	{
		number: 1,
		createdAt: at('2026-04-12T21:40:00'),
		answers: {
			1: { type: 'single', optionId: 'maybe' },
			2: { type: 'multi', optionIds: ['d1'] },
			3: { type: 'text', text: '仕事の都合次第です。' }
		}
	}
];

export const HISTORY_CASES: UiCase<HistoryData>[] = [
	{
		id: 'history-three',
		title: '3版（最新／初回提出の印のある版とない版・版ごとに変わった質問が違う）',
		data: {
			...SESSION,
			form: { id: 'fixtureform1', title: '春合宿の参加確認' },
			response: {
				displayName: 'あおい',
				submittedAt: at('2026-04-12T21:40:00'),
				updatedAt: at('2026-04-14T08:15:00')
			},
			revisions: THREE_REVISIONS,
			questions: QUESTIONS.map(toHistoryQuestion)
		}
	},
	{
		id: 'history-single',
		title: '1版のみ（最新と初回提出の印が並ぶ・その他あり・未回答あり）',
		data: {
			...SESSION,
			form: { id: 'fixtureform1', title: LONG_TITLE },
			response: {
				displayName: 'とてもながい表示名のサーバーメンバーアカウント',
				submittedAt: at('2026-04-12T21:40:00'),
				updatedAt: at('2026-04-12T21:40:00')
			},
			revisions: [{ number: 1, createdAt: at('2026-04-12T21:40:00'), answers: OTHER_ANSWERS }],
			questions: OTHER_QUESTIONS.map(toHistoryQuestion)
		}
	}
];

const ROLES: NewData['roles'] = [
	{ id: ROLE_ID, name: '運営' },
	{ id: '900000000000000011', name: '2026年度生' },
	{ id: '900000000000000012', name: 'OB・OG' },
	{ id: '900000000000000013', name: '見学中' }
];

const CHANNELS: NewData['channels'] = [
	{ id: CHANNEL_ID, name: 'announcements' },
	{ id: '900000000000000021', name: 'general' },
	{ id: '900000000000000022', name: 'staff-only' }
];

type DraftState = NonNullable<NewData['draft']>['state'];

const DRAFT_STATE: DraftState = {
	title: '秋合宿の参加確認',
	description: '11月の合宿について、参加可否を教えてください。',
	targetRoleId: ROLE_ID,
	announcementChannelId: CHANNEL_ID,
	submitScope: 'target_role',
	visibility: 'after_deadline',
	deadline: '2026-10-31T23:59',
	closesAt: '2026-11-01T12:00',
	allowEdit: true,
	closesAtTouched: true,
	questions: [
		{
			type: 'single',
			label: '参加できますか',
			helpText: '確定した予定でお答えください。',
			required: true,
			options: [
				{ id: 'yes', label: '参加する' },
				{ id: 'no', label: '参加しない' }
			],
			allowOther: true
		},
		{
			type: 'text',
			label: '連絡事項',
			helpText: '',
			required: false,
			options: [],
			allowOther: false
		}
	]
};

const draftData = (state: DraftState = DRAFT_STATE): NewData => ({
	...SESSION,
	roles: ROLES,
	channels: CHANNELS,
	draft: { id: 'fixturedraft', version: 3, updatedAt: at('2026-09-29T12:34:00'), state }
});

const FRESH_EDITOR: NewData = { ...SESSION, roles: ROLES, channels: CHANNELS, draft: null };

/** One keystroke's worth of change; the editor saves it at once. */
async function editTitle(doc: Document) {
	const title = doc.querySelector<HTMLInputElement>('input[name="title"]');
	if (!title) return;
	title.value = `${title.value}（改訂）`;
	title.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}

export const NEW_CASES: UiCase<NewData, NewAction>[] = [
	{
		id: 'new-default',
		title: 'ロール / チャンネルあり',
		data: FRESH_EDITOR
	},
	{
		id: 'new-error',
		title: '検証エラー表示',
		data: FRESH_EDITOR,
		form: { message: '受付終了は現在より後の日時を指定してください' }
	},
	{
		id: 'new-draft',
		title: '下書きを開いた（保存済みの時刻）',
		data: draftData()
	},
	{
		id: 'new-draft-saving',
		title: '自動保存中（入力の直後から）',
		data: draftData(),
		setup: editTitle,
		draftApi: 'hang'
	},
	{
		id: 'new-draft-saved',
		title: '最初の自動保存が完了（入力の直後から）',
		data: FRESH_EDITOR,
		setup: editTitle
	},
	{
		id: 'new-draft-failed',
		title: '自動保存に失敗（入力の直後から）',
		data: draftData(),
		setup: editTitle,
		draftApi: 'fail'
	},
	{
		id: 'new-draft-conflict',
		title: '別の画面で更新されていた（409・入力の直後から）',
		data: draftData(),
		setup: editTitle,
		draftApi: 'conflict'
	},
	{
		id: 'new-draft-missing',
		title: '元のロール・チャンネルが見つからない',
		data: draftData({
			...DRAFT_STATE,
			targetRoleId: '900000000000000099',
			announcementChannelId: '900000000000000098'
		})
	},
	{
		id: 'new-other',
		title: '「その他」を追加した質問',
		data: FRESH_EDITOR,
		setup: async (doc) => {
			const fill = (label: string, value: string) => {
				const input = doc.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
				if (!input) return;
				input.value = value;
				input.dispatchEvent(new Event('input', { bubbles: true }));
			};
			const click = (text: string) =>
				[...doc.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)?.click();

			fill('質問 1 の質問文', '参加できる日');
			click('選択肢を追加');
			await tick();
			fill('質問 1 の選択肢 1', '5/2（土）');
			fill('質問 1 の選択肢 2', '5/3（日）');
			click('「その他」を追加');
			await tick();
		}
	}
];

const adminRow = (over: Partial<AdminRow> & Pick<AdminRow, 'id' | 'title'>): AdminRow => ({
	submitScope: 'target_role',
	deadline: at('2026-04-30T23:59:00'),
	submitted: 0,
	targetCount: 0,
	outsiders: 0,
	roleName: '2026年度生',
	closed: false,
	...over
});

export const ADMIN_CASES: UiCase<AdminData, AdminAction>[] = [
	{
		id: 'admin-list',
		title: 'フォーム数件 / 同期済み',
		data: {
			...ADMIN_SESSION,
			syncedAt: at('2026-04-09T08:30:00'),
			forms: [
				adminRow({
					id: 'pending000001',
					title: '春合宿の参加確認',
					submitted: 12,
					targetCount: 18
				}),
				adminRow({
					id: 'pending000002',
					title: '新歓イベントの担当希望',
					submitScope: 'everyone',
					submitted: 1,
					targetCount: 4,
					outsiders: 2
				}),
				adminRow({
					id: 'done00000001',
					title: LONG_TITLE,
					closed: true,
					submitted: 58,
					targetCount: 60,
					roleName: '（削除されたロール）'
				})
			]
		}
	},
	{
		id: 'admin-unsynced',
		title: '未同期',
		data: {
			...ADMIN_SESSION,
			syncedAt: null,
			forms: [
				adminRow({ id: 'pending000001', title: '春合宿の参加確認', submitted: 12, targetCount: 18 })
			]
		}
	},
	{
		id: 'admin-empty',
		title: 'フォーム0件',
		data: { ...ADMIN_SESSION, syncedAt: at('2026-04-09T08:30:00'), forms: [] }
	},
	{
		id: 'admin-wide',
		title: '横に長いフォーム一覧（80字前後のタイトル・削除されたロール）',
		data: {
			...ADMIN_SESSION,
			syncedAt: at('2026-04-09T08:30:00'),
			forms: [
				adminRow({
					id: 'wide00000001',
					title: WIDE_ADMIN_TITLE,
					// With the role gone nobody is in the roster, so every response is an outsider's.
					outsiders: 128,
					roleName: '（削除されたロール）'
				}),
				adminRow({
					id: 'wide00000002',
					title: WIDE_ADMIN_TITLE_2,
					submitScope: 'everyone',
					deadline: null,
					submitted: 107,
					targetCount: 124,
					outsiders: 16,
					roleName: '2026年度 新入生（春入部・仮登録を含む）'
				}),
				adminRow({
					id: 'wide00000003',
					title: '定例会の出欠（10月）',
					submitted: 31,
					targetCount: 31
				}),
				adminRow({
					id: 'wide00000004',
					title: LONG_TITLE,
					closed: true,
					// Frozen at close, so the deleted role no longer empties the roster.
					submitted: 57,
					targetCount: 60,
					outsiders: 3,
					roleName: '（削除されたロール）'
				})
			]
		}
	}
];

export const CASE_GROUPS: { label: string; route: string; cases: { id: string; title: string }[] }[] =
	[
		{ label: 'トップ', route: '/', cases: HOME_CASES },
		{ label: '回答画面', route: '/forms/[id]', cases: ANSWER_CASES },
		{ label: '結果画面', route: '/forms/[id]/results', cases: RESULTS_CASES },
		{ label: '回答履歴', route: '/forms/[id]/results/[responseId]', cases: HISTORY_CASES },
		{ label: 'フォーム作成', route: '/forms/new', cases: NEW_CASES },
		{ label: '管理一覧', route: '/admin/forms', cases: ADMIN_CASES }
	];

export const CASE_IDS: string[] = CASE_GROUPS.flatMap((group) =>
	group.cases.map((entry) => entry.id)
);

export const isCaseId = (value: string): boolean => CASE_IDS.includes(value);
