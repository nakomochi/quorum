/**
 * Static fixtures for the dev-only UI catalogue at /dev/ui.
 *
 * Every shape is derived from the routes' generated `PageData`, so a load-function change that
 * the catalogue does not follow fails `bun run check` instead of silently drifting.
 * This module must never import `$lib/server`: it is shipped to the browser.
 */

import type { PageData as HomeData } from '../../routes/$types';
import type {
	ActionData as AnswerAction,
	PageData as AnswerData
} from '../../routes/forms/[id]/$types';
import type {
	ActionData as ResultsAction,
	PageData as ResultsData
} from '../../routes/forms/[id]/results/$types';
import type { ActionData as NewAction, PageData as NewData } from '../../routes/forms/new/$types';
import type {
	ActionData as AdminAction,
	PageData as AdminData
} from '../../routes/admin/forms/$types';

export type UiCase<Data, Form = null> = {
	id: string;
	title: string;
	data: Data;
	form?: Form;
};

type SessionUser = NonNullable<HomeData['user']>;
type FormRow = HomeData['pending'][number];
type CreatedRow = HomeData['created'][number];
type QuestionRow = AnswerData['questions'][number];
type ResultRow = ResultsData['submitted'][number];
type ResultQuestion = ResultsData['questions'][number];
type Tally = ResultsData['tallies'][number];
type ReminderEntry = ResultsData['reminders'][number];
type FrozenMember = ResultsData['nonSubmitters'][number];
type AdminRow = AdminData['forms'][number];

const at = (jst: string) => new Date(`${jst}+09:00`);

const HOUR_MS = 3_600_000;

/**
 * The home page derives its urgency chips from the clock, so those rows cannot be fixed dates.
 * Snapped to the hour: the server and the hydrating client then format the same string.
 */
const fromNow = (hours: number) =>
	new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS + hours * HOUR_MS);

const ROLE_ID = '900000000000000001';
const CHANNEL_ID = '900000000000000002';
const MESSAGE_ID = '900000000000000003';

const USER: SessionUser = {
	id: 'user_fixture_1',
	name: 'なこもち',
	email: 'fixture@example.invalid',
	emailVerified: true,
	image: null,
	discordId: '100000000000000001',
	createdAt: at('2025-08-05T12:00:00'),
	updatedAt: at('2026-03-01T12:00:00')
};

const LONG_TITLE =
	'2026年度 春合宿の参加可否および宿泊プラン・交通手段・食事アレルギーに関する事前アンケート（回答期限厳守）';

const LONG_DESCRIPTION = [
	'このアンケートは合宿の宿泊手配と貸切バスの座席割当のために使用します。',
	'キャンセル料が発生する日程を過ぎると変更できませんので、確定した内容を入力してください。',
	'不明点がある場合は運営チャンネルまでお問い合わせください。回答内容は運営メンバーのみが閲覧します。'
].join('\n');

// --- builders ---

const formRow = (over: Partial<FormRow> & Pick<FormRow, 'id' | 'title'>): FormRow => ({
	description: null,
	targetRoleId: ROLE_ID,
	submitScope: 'everyone',
	visibility: 'public',
	deadline: at('2026-04-30T23:59:00'),
	closesAt: null,
	allowEdit: true,
	structureLockedAt: null,
	announcementChannelId: CHANNEL_ID,
	announcementMessageId: MESSAGE_ID,
	createdBy: USER.id,
	closedAt: null,
	finalNonSubmitters: null,
	createdAt: at('2026-03-01T10:00:00'),
	updatedAt: at('2026-03-01T10:00:00'),
	...over
});

const createdRow = (over: Partial<CreatedRow> & Pick<CreatedRow, 'id' | 'title'>): CreatedRow => ({
	deadline: at('2026-04-30T23:59:00'),
	closesAt: null,
	closedAt: null,
	responseCount: 0,
	...over
});

const question = (over: Partial<QuestionRow> & Pick<QuestionRow, 'id' | 'label' | 'type'>) => ({
	formId: 'fixtureform1',
	position: over.id,
	helpText: null,
	required: false,
	options: null,
	deletedAt: null,
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

const member = (index: number): FrozenMember => ({
	discordId: `20000000000000${String(index).padStart(4, '0')}`,
	displayName: NAMES[index % NAMES.length] + (index >= NAMES.length ? `${index}` : '')
});

const resultRow = (index: number, answers: ResultRow['answers']): ResultRow => ({
	...member(index),
	submittedAt: at(`2026-09-${String(10 + (index % 10)).padStart(2, '0')}T21:0${index % 10}:00`),
	answers
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

const RESULT_QUESTIONS: ResultQuestion[] = QUESTIONS.map((q) => ({
	id: q.id,
	label: q.label,
	type: q.type,
	options: q.options
}));

const TALLIES: Tally[] = [
	{
		questionId: 1,
		label: '参加できますか',
		type: 'single',
		options: [
			{ id: 'yes', label: '参加する', count: 2 },
			{ id: 'no', label: '参加しない', count: 1 },
			{ id: 'maybe', label: '未定', count: 1 }
		]
	},
	{
		questionId: 2,
		label: '参加できる日',
		type: 'multi',
		options: [
			{ id: 'd1', label: '5/2（土）', count: 2 },
			{ id: 'd2', label: '5/3（日）', count: 1 },
			{ id: 'd3', label: '5/4（月・祝）', count: 1 }
		]
	}
];

const EMPTY_TALLIES: Tally[] = TALLIES.map((tally) => ({
	...tally,
	options: tally.options.map((option) => ({ ...option, count: 0 }))
}));

const NON_SUBMITTERS = [3, 4, 5].map(member);

const MANY_NON_SUBMITTERS = Array.from({ length: 42 }, (_, i) => member(i + 3));

const REMINDERS: ReminderEntry[] = [
	{ id: 3, kind: 'manual', sentAt: at('2026-04-28T19:00:00'), targetCount: 42, messageCount: 1 },
	{ id: 2, kind: 'auto', sentAt: at('2026-04-27T09:00:00'), targetCount: 51, messageCount: 2 },
	{ id: 1, kind: 'manual', sentAt: at('2026-04-20T12:30:00'), targetCount: 60, messageCount: 2 }
];

const answerForm = (over: Partial<AnswerData['form']> = {}): AnswerData['form'] => ({
	id: 'fixtureform1',
	title: '春合宿の参加確認',
	description: '5月の合宿について、参加可否を教えてください。',
	deadline: at('2026-04-30T23:59:00'),
	closesAt: at('2026-05-01T00:00:00'),
	allowEdit: true,
	...over
});

const FILLED_ANSWERS: AnswerData['answers'] = {
	1: { type: 'single', optionId: 'yes' },
	2: { type: 'multi', optionIds: ['d1', 'd3'] },
	3: { type: 'text', text: '甲殻類アレルギーがあります。\n初日は21時ごろ合流します。' },
	4: { type: 'date', date: '2026-05-02' }
};

const resultsForm = (over: Partial<ResultsData['form']> = {}): ResultsData['form'] => ({
	id: 'fixtureform1',
	title: '春合宿の参加確認',
	description: '5月の合宿について、参加可否を教えてください。',
	visibility: 'public',
	deadline: at('2026-04-30T23:59:00'),
	closesAt: at('2026-05-01T00:00:00'),
	closedAt: null,
	...over
});

// --- cases ---

export const HOME_CASES: UiCase<HomeData>[] = [
	{
		id: 'home-anonymous',
		title: '未ログイン',
		data: { user: null, member: false, isAdmin: false, pending: [], submitted: [], created: [] }
	},
	{
		id: 'home-empty',
		title: 'メンバー / フォーム0件',
		data: { user: USER, member: true, isAdmin: false, pending: [], submitted: [], created: [] }
	},
	{
		id: 'home-member',
		title: 'メンバー / 未提出・提出済み・作成済み',
		data: {
			user: USER,
			member: true,
			isAdmin: false,
			pending: [
				formRow({ id: 'pending000001', title: '春合宿の参加確認', deadline: fromNow(-36) }),
				formRow({ id: 'pending000002', title: '新歓イベントの担当希望', deadline: fromNow(30) }),
				formRow({ id: 'pending000003', title: '定例会の出欠（10月）', deadline: fromNow(24 * 21) }),
				formRow({ id: 'pending000004', title: 'Tシャツのサイズ調査', deadline: null })
			],
			submitted: [
				formRow({ id: 'done00000001', title: '夏合宿のふりかえり', deadline: at('2026-03-31T23:59:00') }),
				formRow({ id: 'done00000002', title: '定例会の出欠（8月）', deadline: at('2026-03-10T20:00:00') })
			],
			created: [
				createdRow({ id: 'mine00000001', title: '春合宿の参加確認', responseCount: 12 }),
				createdRow({
					id: 'mine00000002',
					title: LONG_TITLE,
					responseCount: 3,
					deadline: null
				})
			]
		}
	},
	{
		id: 'home-long-lists',
		title: 'メンバー / 提出済みと作成済みが多い',
		data: {
			user: USER,
			member: true,
			isAdmin: false,
			pending: [formRow({ id: 'pending000001', title: '春合宿の参加確認', deadline: fromNow(30) })],
			submitted: Array.from({ length: 9 }, (_, i) =>
				formRow({
					id: `done0000000${i + 1}`,
					title: `定例会の出欠（第 ${i + 1} 回）`,
					deadline: fromNow(-24 * 7 * (i + 1))
				})
			),
			created: Array.from({ length: 6 }, (_, i) =>
				createdRow({
					id: `mine0000000${i + 1}`,
					title: `イベントの出欠確認 ${i + 1}`,
					responseCount: 20 - i * 3,
					deadline: fromNow(-24 * 10 * (i + 1))
				})
			)
		}
	},
	{
		id: 'home-outsider',
		title: '非メンバー',
		data: { user: USER, member: false, isAdmin: false, pending: [], submitted: [], created: [] }
	},
	{
		id: 'home-admin',
		title: '運営（管理リンクあり）',
		data: {
			user: { ...USER, image: null, name: 'とてもながい表示名のギルド運営アカウント' },
			member: true,
			isAdmin: true,
			pending: [formRow({ id: 'pending000001', title: '春合宿の参加確認' })],
			submitted: [],
			created: [createdRow({ id: 'mine00000001', title: '春合宿の参加確認', responseCount: 12 })]
		}
	}
];

export const ANSWER_CASES: UiCase<AnswerData, AnswerAction>[] = [
	{
		id: 'answer-fresh',
		title: '未提出（新規回答）',
		data: {
			user: USER,
			resultsVisible: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			answers: {}
		}
	},
	{
		id: 'answer-editable',
		title: '提出済み / 編集可',
		data: {
			user: USER,
			resultsVisible: true,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: at('2026-04-12T21:40:00'),
			answers: FILLED_ANSWERS
		}
	},
	{
		id: 'answer-readonly',
		title: '提出済み / 編集不可',
		data: {
			user: USER,
			resultsVisible: true,
			form: answerForm({ allowEdit: false }),
			questions: QUESTIONS,
			closed: false,
			editable: false,
			submittedAt: at('2026-04-12T21:40:00'),
			answers: FILLED_ANSWERS
		}
	},
	{
		id: 'answer-closed',
		title: 'クローズ済み / 未回答',
		data: {
			user: USER,
			resultsVisible: true,
			form: answerForm({ closesAt: at('2026-04-20T23:59:00') }),
			questions: QUESTIONS,
			closed: true,
			editable: false,
			submittedAt: null,
			answers: {}
		}
	},
	{
		id: 'answer-error',
		title: 'エラー表示',
		data: {
			user: USER,
			resultsVisible: false,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			answers: {}
		},
		form: { message: '「連絡事項があれば書いてください」は必須です' }
	},
	{
		id: 'answer-saved',
		title: '保存成功',
		data: {
			user: USER,
			resultsVisible: true,
			form: answerForm(),
			questions: QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: at('2026-04-12T21:40:00'),
			answers: FILLED_ANSWERS
		},
		form: { saved: true }
	},
	{
		id: 'answer-overflow',
		title: '長文タイトル / 選択肢14個',
		data: {
			user: USER,
			resultsVisible: true,
			form: answerForm({ title: LONG_TITLE, description: LONG_DESCRIPTION, deadline: null }),
			questions: OVERFLOW_QUESTIONS,
			closed: false,
			editable: true,
			submittedAt: null,
			answers: {}
		}
	}
];

export const RESULTS_CASES: UiCase<ResultsData, ResultsAction>[] = [
	{
		id: 'results-viewer',
		title: '一般閲覧（manage: false）',
		data: {
			user: USER,
			form: resultsForm(),
			manage: false,
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
		title: '管理者（操作ボタンあり）',
		data: {
			user: USER,
			form: resultsForm(),
			manage: true,
			announceFailed: false,
			announcement: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
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
		id: 'results-many-pending',
		title: '未提出者が多数',
		data: {
			user: USER,
			form: resultsForm(),
			manage: true,
			announceFailed: false,
			announcement: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
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
			user: USER,
			form: resultsForm({ visibility: 'after_deadline' }),
			manage: true,
			announceFailed: false,
			announcement: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
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
		title: 'クローズ済み（凍結表示）',
		data: {
			user: USER,
			form: resultsForm({ closedAt: at('2026-05-01T00:05:00') }),
			manage: true,
			announceFailed: false,
			announcement: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
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
		id: 'results-reminders',
		title: 'リマインド送信履歴あり',
		data: {
			user: USER,
			form: resultsForm(),
			manage: true,
			announceFailed: false,
			announcement: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
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
		id: 'results-empty',
		title: '回答0件',
		data: {
			user: USER,
			form: resultsForm(),
			manage: true,
			announceFailed: false,
			announcement: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
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
			user: USER,
			form: resultsForm({ title: LONG_TITLE }),
			manage: true,
			announceFailed: false,
			announcement: { channelId: null, messageId: null },
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
			user: USER,
			form: resultsForm(),
			manage: true,
			announceFailed: true,
			announcement: { channelId: CHANNEL_ID, messageId: null },
			reminders: [],
			questions: RESULT_QUESTIONS,
			tallies: TALLIES,
			frozen: false,
			targetCount: 6,
			submitted: SUBMITTED,
			outsiders: [],
			nonSubmitters: NON_SUBMITTERS
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

export const NEW_CASES: UiCase<NewData, NewAction>[] = [
	{
		id: 'new-default',
		title: 'ロール / チャンネルあり',
		data: { user: USER, roles: ROLES, channels: CHANNELS }
	},
	{
		id: 'new-error',
		title: '検証エラー表示',
		data: { user: USER, roles: ROLES, channels: CHANNELS },
		form: { message: '受付終了は現在より後の日時を指定してください' }
	}
];

const adminRow = (over: Partial<AdminRow> & Pick<AdminRow, 'id' | 'title'>): AdminRow => ({
	targetRoleId: ROLE_ID,
	submitScope: 'target_role',
	deadline: at('2026-04-30T23:59:00'),
	closesAt: null,
	closedAt: null,
	structureLockedAt: null,
	responseCount: 0,
	roleName: '2026年度生',
	closed: false,
	...over
});

export const ADMIN_CASES: UiCase<AdminData, AdminAction>[] = [
	{
		id: 'admin-list',
		title: 'フォーム数件 / 同期済み',
		data: {
			user: USER,
			syncedAt: at('2026-04-09T08:30:00'),
			forms: [
				adminRow({
					id: 'pending000001',
					title: '春合宿の参加確認',
					responseCount: 12,
					structureLockedAt: at('2026-03-02T10:00:00')
				}),
				adminRow({
					id: 'pending000002',
					title: '新歓イベントの担当希望',
					submitScope: 'everyone',
					responseCount: 4
				}),
				adminRow({
					id: 'done00000001',
					title: LONG_TITLE,
					closed: true,
					closedAt: at('2026-04-01T00:00:00'),
					structureLockedAt: at('2026-03-10T10:00:00'),
					responseCount: 60,
					roleName: '900000000000000099'
				})
			]
		}
	},
	{
		id: 'admin-unsynced',
		title: '未同期',
		data: {
			user: USER,
			syncedAt: null,
			forms: [adminRow({ id: 'pending000001', title: '春合宿の参加確認', responseCount: 12 })]
		}
	},
	{
		id: 'admin-empty',
		title: 'フォーム0件',
		data: { user: USER, syncedAt: at('2026-04-09T08:30:00'), forms: [] }
	}
];

export const CASE_GROUPS: { label: string; route: string; cases: { id: string; title: string }[] }[] =
	[
		{ label: 'トップ', route: '/', cases: HOME_CASES },
		{ label: '回答画面', route: '/forms/[id]', cases: ANSWER_CASES },
		{ label: '結果画面', route: '/forms/[id]/results', cases: RESULTS_CASES },
		{ label: 'フォーム作成', route: '/forms/new', cases: NEW_CASES },
		{ label: '管理一覧', route: '/admin/forms', cases: ADMIN_CASES }
	];

export const CASE_IDS: string[] = CASE_GROUPS.flatMap((group) =>
	group.cases.map((entry) => entry.id)
);

export const isCaseId = (value: string): boolean => CASE_IDS.includes(value);
