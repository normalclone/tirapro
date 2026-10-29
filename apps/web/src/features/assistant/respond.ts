import type { IssueDto, SprintDto } from '@tirapro/types';
import type { CreateIssueInput } from '@/features/issues/create-api';
import { fmtDate } from '@/lib/dateFormat';
import { dueDaysFromToday, isOverdue } from '@/lib/dueDate';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';
import type { Block, Chip, IssueRow } from './blocks';
import { buildDraft, type Draft, type DraftMeta } from './draft';
import type { Intent, TypeHint } from './intents';
import { MIN_SCORE, POPULAR_QUESTIONS, searchKnowledge } from './knowledge';
import { dueJql, filtersHref, myIssuesJql, overdueJql, searchJql } from './queries';
import { screenInfoOf } from './screens';

/**
 * Bộ trả lời của Trợ lý (chế độ cơ bản): ý định → các khối nội dung. KHÔNG gọi AI ngoài; dữ liệu lấy qua `AssistantDeps`
 * (bọc API sẵn có, quyền theo phiên người dùng) nên test thay được bằng giả lập. `respond` KHÔNG BAO GIỜ tạo việc:
 * chỉ dựng thẻ nháp; việc chỉ được tạo khi người dùng bấm "Tạo" → `confirmDraft`.
 */
export interface AssistantProject {
  id: string;
  key: string;
  name: string;
}

export interface RespondEnv {
  pathname: string;
  now?: Date;
  /** Dự án hiện tại (từ `/p/:key` hoặc dự án của việc đang xem); null = ngoài dự án. */
  project: AssistantProject | null;
  /** Dự án đang hoạt động (người dùng thấy). */
  projects: AssistantProject[];
  /** Key dự án dùng gần đây, mới nhất trước. */
  recentKeys: string[];
  tour: { available: boolean; title?: string; description?: string | null };
  /** Mã việc đang xem (`/issue/:key`). */
  issueKey: string | null;
  /** Người dùng vừa chọn dự án bằng chip cho lệnh tạo việc. */
  forceProjectKey?: string;
}

export interface AssistantDeps {
  searchJql(jql: string): Promise<{ items: IssueDto[]; hasMore: boolean }>;
  getIssue(key: string): Promise<IssueDto | null>;
  getCommentCount(issueId: string): Promise<number>;
  getProjectIssues(projectId: string): Promise<IssueDto[]>;
  getSprints(projectId: string): Promise<SprintDto[]>;
  getMeta(projectKey: string): Promise<DraftMeta>;
  getUsers(projectId: string): Promise<{ id: string; displayName: string }[]>;
  /** undefined = chưa biết (API vẫn kiểm khi tạo). */
  canCreate(projectId: string): Promise<boolean | undefined>;
}

export const MAX_ROWS = 5;
const text = (t: string): Block => ({ type: 'text', text: t });
const chips = (c: Chip[]): Block => ({ type: 'chips', chips: c });
const chipsOf = (qs: string[]): Chip[] => qs.map((q) => ({ label: q, text: q }));
const docTo = (anchor: string) => `/documentation#${anchor}`;

/** Chip gợi ý khi mở panel / sau lời chào: hợp màn hiện tại (3–4 chip). */
export function suggestionChips(pathname: string): Chip[] {
  return chipsOf(screenInfoOf(pathname).chips.slice(0, 4));
}

/** Lời chào + chip gợi ý hợp màn hiện tại — câu đầu tiên khi mở panel. */
export function greetingBlocks(pathname: string): Block[] {
  return [
    text(
      'Xin chào! Mình là Trợ lý Tirapro — hỏi cách dùng, tra việc của bạn, hoặc nhờ soạn nháp việc mới. Mình chạy ngay trong trình duyệt, không gửi nội dung của bạn ra ngoài.',
    ),
    chips(suggestionChips(pathname)),
  ];
}

const rowOf = (i: IssueDto, now: Date): IssueRow => ({
  key: i.key,
  summary: i.summary,
  status: i.status.name,
  due: i.dueDate ? fmtDate(i.dueDate) : null,
  overdue: isOverdue(i, now),
});

const scopeLabel = (e: RespondEnv) =>
  e.project ? `trong dự án ${e.project.key}` : 'trong toàn bộ workspace';

async function issueList(
  title: string,
  jql: string,
  e: RespondEnv,
  deps: AssistantDeps,
  emptyText: string,
): Promise<Block[]> {
  const { items, hasMore } = await deps.searchJql(jql);
  if (items.length === 0) return [text(emptyText)];
  const now = e.now ?? new Date();
  const total = hasMore ? `hơn ${items.length}` : String(items.length);
  return [
    text(
      `${title} ${scopeLabel(e)}: ${total} việc${items.length > MAX_ROWS ? ` (hiện ${MAX_ROWS} việc đầu)` : ''}.`,
    ),
    {
      type: 'issues',
      rows: items.slice(0, MAX_ROWS).map((i) => rowOf(i, now)),
      more: items.length > MAX_ROWS || hasMore,
      seeAllTo: filtersHref(jql),
    },
  ];
}

const personOf = (i: IssueDto) => i.assignee?.displayName ?? 'Chưa gán';

async function issueFacts(issue: IssueDto, deps: AssistantDeps, now: Date): Promise<Block[]> {
  const [comments, all] = await Promise.all([
    deps.getCommentCount(issue.id),
    deps.getProjectIssues(issue.projectId),
  ]);
  const children = all.filter((i) => i.parentId === issue.id).length;
  const overdue = isOverdue(issue, now);
  const dueLabel = issue.dueDate
    ? `${fmtDate(issue.dueDate)}${overdue ? ` (quá hạn ${Math.abs(dueDaysFromToday(issue.dueDate, now))} ngày)` : ''}`
    : 'Chưa đặt';
  return [
    {
      type: 'facts',
      title: `${issue.key} — ${issue.summary}`,
      rows: [
        { label: 'Loại', value: issue.type.name },
        { label: 'Trạng thái', value: issue.status.name },
        { label: 'Người phụ trách', value: personOf(issue) },
        { label: 'Ưu tiên', value: issue.priority?.name ?? 'Chưa đặt' },
        { label: 'Hạn', value: dueLabel },
        { label: 'Việc con', value: String(children) },
        { label: 'Bình luận', value: String(comments) },
      ],
      to: { label: 'Mở công việc', to: `/issue/${issue.key}` },
    },
  ];
}

async function sprintStatus(e: RespondEnv, deps: AssistantDeps): Promise<Block[]> {
  const p = e.project;
  if (!p)
    return [
      text('Bạn muốn xem sprint của dự án nào?'),
      chips(projectChips('Sprint hiện tại thế nào', e)),
    ];
  const sprints = await deps.getSprints(p.id);
  const active = sprints.find((s) => s.state === 'ACTIVE');
  if (!active) {
    const future = sprints.filter((s) => s.state === 'FUTURE').length;
    return [
      text(
        `Dự án ${p.key} chưa có sprint nào đang chạy${future ? ` (có ${future} sprint sắp tới)` : ''}. Vào Việc chờ để lập và bắt đầu sprint.`,
      ),
      chips(chipsOf(['Làm sao tạo sprint?'])),
    ];
  }
  // Đếm từ danh sách việc của dự án (cùng cache với Bảng việc): đủ mọi việc, không bị cắt như kết quả tìm kiếm.
  const items = (await deps.getProjectIssues(p.id)).filter((i) => i.sprintId === active.id);
  const count: Record<string, number> = {};
  for (const i of items) count[i.status.category] = (count[i.status.category] ?? 0) + 1;
  const by = (['TODO', 'IN_PROGRESS', 'DONE'] as const)
    .map((c) => `${STATUS_CATEGORY_LABEL[c]}: ${count[c] ?? 0}`)
    .join(' · ');
  const end = active.endDate ? fmtDate(active.endDate) : 'Chưa đặt';
  const left = active.endDate ? dueDaysFromToday(active.endDate, e.now ?? new Date()) : null;
  const leftLabel =
    left == null || Number.isNaN(left)
      ? ''
      : left >= 0
        ? ` (còn ${left} ngày)`
        : ` (đã quá ${-left} ngày)`;
  return [
    {
      type: 'facts',
      title: `Sprint đang chạy: ${active.name}`,
      rows: [
        { label: 'Kết thúc', value: `${end}${leftLabel}` },
        { label: 'Số việc', value: String(items.length) },
        { label: 'Theo trạng thái', value: by },
        ...(active.goal ? [{ label: 'Mục tiêu', value: active.goal }] : []),
      ],
      to: { label: 'Mở Bảng việc', to: `/p/${p.key}/board` },
    },
  ];
}

/** Chip chọn dự án (gần dùng trước) cho một câu: bấm = gửi lại `command` với dự án đó. */
function projectChips(command: string, e: RespondEnv): Chip[] {
  const rank = (k: string) => {
    const i = e.recentKeys.findIndex((r) => r.toLowerCase() === k.toLowerCase());
    return i < 0 ? 999 : i;
  };
  return [...e.projects]
    .sort((a, b) => rank(a.key) - rank(b.key))
    .slice(0, 5)
    .map((p) => ({ label: `${p.key} · ${p.name}`, text: command, projectKey: p.key }));
}

const commandText = (hint: TypeHint, rest: string) => `tạo ${hint ?? 'việc'} ${rest}`.trim();

const CREATE_EXAMPLE = 'tạo việc Sửa lỗi đăng nhập !cao @an ^mai #sprint ~3';

async function createFlow(
  intent: Extract<Intent, { kind: 'create' }>,
  e: RespondEnv,
  deps: AssistantDeps,
): Promise<Block[]> {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const forced = e.forceProjectKey
    ? e.projects.find((p) => same(p.key, e.forceProjectKey!))
    : undefined;
  const project =
    forced ?? (e.project ? e.projects.find((p) => same(p.key, e.project!.key)) : undefined);
  const command = commandText(intent.typeHint, intent.text);

  if (!project) {
    if (e.projects.length === 0)
      return [text('Chưa có dự án nào để tạo việc — hãy tạo một dự án trước.')];
    const archived = e.project && !e.projects.some((p) => same(p.key, e.project!.key));
    return [
      text(
        archived
          ? `Dự án ${e.project!.key} không còn hoạt động nên không thêm việc được. Chọn một dự án khác:`
          : 'Bạn muốn tạo việc ở dự án nào?',
      ),
      chips(projectChips(command, e)),
    ];
  }
  if ((await deps.canCreate(project.id)) === false)
    return [
      text(
        `Bạn không có quyền tạo việc trong dự án ${project.key}. Hãy nhờ quản trị dự án hoặc quản trị chung nâng vai trò của bạn.`,
      ),
    ];
  if (!intent.text.trim())
    return [
      text(
        `Mình sẽ tạo trong dự án ${project.key}. Bạn muốn tạo việc gì? Gõ tiêu đề sau lệnh, ví dụ:`,
      ),
      chips([{ label: CREATE_EXAMPLE, text: CREATE_EXAMPLE }]),
    ];

  const [meta, users, sprints] = await Promise.all([
    deps.getMeta(project.key),
    deps.getUsers(project.id),
    deps.getSprints(project.id),
  ]);
  const draft = buildDraft({
    text: intent.text,
    typeHint: intent.typeHint,
    project,
    meta,
    users,
    sprints,
  });
  if (!draft)
    return [
      text(
        'Tiêu đề đang trống (chỉ có ký hiệu ! @ # ~ ^). Hãy gõ tiêu đề trước, rồi mới đến các ký hiệu.',
      ),
      chips([{ label: CREATE_EXAMPLE, text: CREATE_EXAMPLE }]),
    ];
  return [
    text(
      `Mình soạn nháp một việc trong dự án ${project.key}. Kiểm tra rồi bấm Tạo — chưa có gì được tạo cho tới khi bạn xác nhận.`,
    ),
    { type: 'draft', draft, status: 'pending' },
  ];
}

function unknownReply(query: string, e: RespondEnv): Block[] {
  const q = query.trim();
  const sample = [...screenInfoOf(e.pathname).chips.slice(0, 2), ...POPULAR_QUESTIONS.slice(0, 3)];
  return [
    text(
      'Mình chưa hiểu câu này. Bạn thử hỏi cách dùng (vd "làm sao tạo sprint"), tra việc ("việc quá hạn"), hoặc nhờ soạn việc ("tạo việc …").',
    ),
    chips([
      ...(q && q.length <= 80 ? [{ label: `Tìm “${q}” trong công việc`, text: `tìm ${q}` }] : []),
      ...chipsOf(sample),
    ]),
  ];
}

function helpReply(query: string, e: RespondEnv): Block[] {
  const hits = searchKnowledge(query, 3);
  if (hits.length === 0) return unknownReply(query, e);
  const best = hits[0]!.score;
  const keep = hits.filter((h) => h.score >= Math.max(MIN_SCORE, best * 0.5));
  return [
    text(
      keep.length === 1
        ? 'Mình tìm được hướng dẫn này:'
        : `Mình tìm được ${keep.length} hướng dẫn liên quan:`,
    ),
    {
      type: 'links',
      items: keep.map(({ entry }) => ({
        title: entry.title,
        summary: entry.summary,
        to: docTo(entry.anchor),
        linkLabel: 'Xem hướng dẫn',
        ...(entry.open && (e.project || !entry.open.to.includes(':key'))
          ? {
              extra: {
                label: entry.open.label,
                to: entry.open.to.replace(':key', e.project?.key ?? ''),
              },
            }
          : {}),
      })),
    },
  ];
}

/** Trả lời một ý định. Ném lỗi mạng/API lên cho nơi gọi hiển thị (kèm thông báo tiếng Việt). */
export async function respond(
  intent: Intent,
  env: RespondEnv,
  deps: AssistantDeps,
): Promise<Block[]> {
  // Người dùng vừa chọn dự án bằng chip → dự án đó thay "dự án hiện tại" cho MỌI ý định của lượt này (chỉ lượt này).
  const forced = env.forceProjectKey
    ? env.projects.find((p) => p.key.toLowerCase() === env.forceProjectKey!.toLowerCase())
    : undefined;
  const e: RespondEnv = forced ? { ...env, project: forced } : env;
  const now = e.now ?? new Date();
  const key = e.project?.key;
  switch (intent.kind) {
    case 'empty':
      return [];
    case 'greeting':
      return greetingBlocks(e.pathname);
    case 'capabilities':
      return [
        text(
          'Mình giúp được 4 việc:\n• Hỏi đáp theo màn hình bạn đang đứng ("màn này dùng để làm gì")\n• Hướng dẫn sử dụng ("làm sao tạo sprint")\n• Tra việc ("việc của tôi", "việc quá hạn", "tìm đăng nhập", "BUG-12")\n• Soạn nháp việc mới ("tạo việc Sửa lỗi login !cao @an ^mai") — bạn bấm Tạo mới có việc.',
        ),
        chips(suggestionChips(e.pathname)),
      ];
    case 'screen': {
      const info = screenInfoOf(e.pathname);
      const out: Block[] = [text(`${info.name}: ${info.purpose}`)];
      if (e.tour.available) {
        if (e.tour.title)
          out.push(
            text(
              `Hướng dẫn từng bước: ${e.tour.title}${e.tour.description ? ` — ${e.tour.description}` : ''}`,
            ),
          );
        out.push({ type: 'tour', label: 'Chạy hướng dẫn từng bước' });
      }
      if (info.docAnchor)
        out.push({
          type: 'links',
          items: [
            {
              title: info.name,
              summary: info.purpose,
              to: docTo(info.docAnchor),
              linkLabel: 'Xem hướng dẫn',
            },
          ],
        });
      return out;
    }
    case 'issue-summary': {
      if (!e.issueKey)
        return [
          text('Mở một công việc rồi hỏi lại, hoặc gõ mã công việc (vd BUG-12) để mình tóm tắt.'),
        ];
      const issue = await deps.getIssue(e.issueKey);
      if (!issue)
        return [
          text(`Không thấy công việc ${e.issueKey} (có thể sai mã hoặc bạn không có quyền xem).`),
        ];
      return issueFacts(issue, deps, now);
    }
    case 'issue-key': {
      const issue = await deps.getIssue(intent.key);
      if (!issue)
        return [
          text(`Không thấy công việc ${intent.key} (có thể sai mã hoặc bạn không có quyền xem).`),
        ];
      return issueFacts(issue, deps, now);
    }
    case 'sprint-status':
      return sprintStatus(e, deps);
    case 'my-issues':
      return issueList(
        'Việc đang giao cho bạn',
        myIssuesJql(key),
        e,
        deps,
        `Bạn chưa có việc nào đang mở ${scopeLabel(e)}.`,
      );
    case 'overdue':
      return issueList(
        'Việc quá hạn',
        overdueJql(key),
        e,
        deps,
        `Không có việc nào quá hạn ${scopeLabel(e)}.`,
      );
    case 'due':
      return issueList(
        intent.period === 'week' ? 'Việc đến hạn trong tuần này' : 'Việc đến hạn hôm nay',
        dueJql(intent.period, key),
        e,
        deps,
        `Không có việc nào đến hạn ${intent.period === 'week' ? 'trong tuần này' : 'hôm nay'} ${scopeLabel(e)}.`,
      );
    case 'search':
      return issueList(
        `Kết quả cho “${intent.query}”`,
        searchJql(intent.query, key),
        e,
        deps,
        `Không tìm thấy việc nào khớp “${intent.query}” ${scopeLabel(e)}.`,
      );
    case 'create':
      return createFlow(intent, e, deps);
    case 'help':
      return helpReply(intent.query, e);
  }
}

export type ConfirmResult = { ok: true; id: string; key: string } | { ok: false; error: string };

/**
 * Bước DUY NHẤT tạo việc của Trợ lý — chỉ gọi từ nút "Tạo" trên thẻ nháp. `create` là mutation tạo việc có sẵn
 * (`useCreateIssue`); thất bại trả `ok:false` kèm thông báo để thẻ hiện lỗi và cho bấm lại.
 */
export async function confirmDraft(
  draft: Draft,
  create: (input: CreateIssueInput) => Promise<{ id: string; key: string }>,
  describeError: (e: unknown) => string,
): Promise<ConfirmResult> {
  if (!draft.input.summary.trim()) return { ok: false, error: 'Tiêu đề đang trống.' };
  try {
    const made = await create(draft.input);
    return { ok: true, id: made.id, key: made.key };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}
