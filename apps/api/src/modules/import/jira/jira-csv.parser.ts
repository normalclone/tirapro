import { parse as streamParse } from 'csv-parse';
import { parse } from 'csv-parse/sync';
import { pipeline, Readable } from 'node:stream';
import type { JiraAnalyzeResult } from '@tirapro/types';

/** Một comment Jira đã tách (`dd/MMM/yy h:mm a;accountId;nội dung`). */
export interface JiraComment {
  createdAt: Date | null;
  /** accountId (Cloud), username (Server) hoặc email; null nếu cột không có tác giả. */
  authorRef: string | null;
  body: string;
}

/** Một issue của file export Jira, cột lặp (Labels/Sprint/Comment) đã gộp thành mảng. */
export interface JiraIssueRow {
  /** Số thứ tự dòng dữ liệu, bắt đầu từ 1 (không tính dòng tiêu đề). */
  row: number;
  key: string;
  id: string;
  summary: string;
  issueType: string;
  status: string;
  priority: string;
  resolution: string;
  assignee: string;
  assigneeId: string;
  reporter: string;
  reporterId: string;
  creator: string;
  creatorId: string;
  created: Date | null;
  updated: Date | null;
  resolved: Date | null;
  dueDate: Date | null;
  labels: string[];
  sprints: string[];
  /** Giá trị cột Parent / Parent id: có thể là mã issue (ABC-1) hoặc id số, tuỳ phiên bản Jira. */
  parentRef: string;
  /** Giá trị cột Custom field (Epic Link): mã issue của epic. */
  epicRef: string;
  description: string;
  storyPoints: number | null;
  comments: JiraComment[];
  /** Giây. */
  timeSpent: number | null;
  /** Giây. */
  originalEstimate: number | null;
  projectKey: string;
}

export interface JiraParseResult {
  issues: JiraIssueRow[];
  /** Tên cột (đúng như trong file) mà importer không dùng đến. */
  unknownColumns: string[];
  /** Từ accountId (hoặc username) → tên hiển thị, suy ra từ các cột Assignee/Reporter/Creator + "… Id". */
  accountNames: Map<string, string>;
}

/** Cột importer đọc (so khớp không phân biệt hoa/thường). */
const USED_COLUMNS = new Set([
  'summary',
  'issue key',
  'issue id',
  'issue type',
  'status',
  'priority',
  'resolution',
  'assignee',
  'assignee id',
  'reporter',
  'reporter id',
  'creator',
  'creator id',
  'created',
  'updated',
  'resolved',
  'due date',
  'labels',
  'sprint',
  'parent',
  'parent id',
  'custom field (epic link)',
  'description',
  'comment',
  'story points',
  'custom field (story points)',
  'story point estimate',
  'custom field (story point estimate)',
  'time spent',
  'original estimate',
  'project key',
]);

/** Cột chuẩn của Jira mà ta cố ý bỏ qua — không đáng báo "cột lạ". */
const IGNORED_COLUMNS = new Set([
  'project name',
  'project type',
  'project lead',
  'project lead id',
  'project description',
  'project url',
  'parent summary',
  'status category',
  'status category changed',
  'last viewed',
  'remaining estimate',
  'custom field (epic name)',
  'custom field (epic status)',
  'custom field (rank)',
  'security level',
  'votes',
  'watchers',
]);

const STORY_POINT_COLUMNS = [
  'custom field (story points)',
  'story points',
  'custom field (story point estimate)',
  'story point estimate',
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const DATE_RE =
  /^(\d{1,2})\/([A-Za-z]{3,})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/;
const COMMENT_RE =
  /^(\d{1,2}\/[A-Za-z]{3,}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)?);([^;]*);([\s\S]*)$/;

/**
 * Đọc ngày của Jira (`15/Oct/26 9:30 AM`, `15/Oct/2026 09:30`, `15/Oct/26`) hoặc ISO.
 * Jira không ghi múi giờ nên coi là UTC để kết quả không phụ thuộc máy chạy. Null nếu không hợp lệ.
 */
export function parseJiraDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const m = DATE_RE.exec(s);
  if (!m) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const yearRaw = m[3]!;
  const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
  let hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  const meridiem = m[6]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  const d = new Date(Date.UTC(year, month, day, hour, minute));
  // Date.UTC tự "tràn" ngày (31/Feb → 3/Mar) → so lại để loại ngày không tồn tại.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day)
    return null;
  return d;
}

/** Số giây/điểm: cho phép dấu phẩy thập phân. Null nếu rỗng hoặc không phải số. */
function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseComment(raw: string): JiraComment | null {
  const text = raw.trim();
  if (!text) return null;
  const m = COMMENT_RE.exec(text);
  if (!m) return { createdAt: null, authorRef: null, body: text };
  const createdAt = parseJiraDate(m[1]!);
  const body = m[3]!.trim();
  if (!body) return null;
  return { createdAt, authorRef: m[2]!.trim() || null, body };
}

/** Mã project từ mã issue: `ABC-12` → `ABC`. */
function projectKeyOf(issueKey: string): string {
  const i = issueKey.lastIndexOf('-');
  return i > 0 ? issueKey.slice(0, i) : '';
}

const CSV_OPTS = {
  bom: true,
  skip_empty_lines: true,
  relax_column_count: true,
  trim: false,
} as const;

/** Kích thước mỗi mảnh đẩy vào parser stream. */
const STREAM_CHUNK_BYTES = 65_536;
/** Sau chừng này dòng, parser async nhường event loop một lượt. */
const YIELD_EVERY_ROWS = 500;

/**
 * Dựng JiraIssueRow từ từng record CSV. Đọc theo MẢNG (không theo tên cột) vì Jira lặp tên cột
 * `Labels`/`Sprint`/`Comment` — đọc theo object sẽ chỉ còn giá trị cuối. Dùng chung cho bản
 * đồng bộ và bản stream để hai đường cho kết quả giống hệt.
 */
class JiraRowBuilder {
  readonly issues: JiraIssueRow[] = [];
  readonly accountNames = new Map<string, string>();
  readonly unknownColumns: string[] = [];
  private readonly indexes = new Map<string, number[]>();
  private readonly spIdx: number[];
  private readonly descIdx: number[];

  constructor(header: string[]) {
    const lower = header.map((h) => h.toLowerCase());
    lower.forEach((h, i) => {
      const list = this.indexes.get(h);
      if (list) list.push(i);
      else this.indexes.set(h, [i]);
    });
    if (!lower.includes('summary')) {
      throw new Error(
        'Tệp không có cột "Summary" — hãy xuất từ Jira bằng "Export issues → CSV (tất cả các trường)"',
      );
    }
    if (!lower.includes('issue key')) {
      throw new Error(
        'Tệp không có cột "Issue key" — hãy xuất từ Jira bằng "Export issues → CSV (tất cả các trường)"',
      );
    }

    const seenUnknown = new Set<string>();
    header.forEach((h, i) => {
      const l = lower[i]!;
      if (!h || USED_COLUMNS.has(l) || IGNORED_COLUMNS.has(l) || seenUnknown.has(l)) return;
      seenUnknown.add(l);
      this.unknownColumns.push(h);
    });

    this.spIdx = STORY_POINT_COLUMNS.flatMap((n) => this.indexesOf(n));
    this.descIdx = this.indexesOf('description');
  }

  private indexesOf(name: string): number[] {
    return this.indexes.get(name) ?? [];
  }

  private first(cells: string[], name: string): string {
    for (const i of this.indexesOf(name)) {
      const v = (cells[i] ?? '').trim();
      if (v) return v;
    }
    return '';
  }

  private all(cells: string[], name: string): string[] {
    return this.indexesOf(name)
      .map((i) => (cells[i] ?? '').trim())
      .filter(Boolean);
  }

  add(cells: string[]): void {
    const first = (name: string): string => this.first(cells, name);
    const summary = first('summary');
    const key = first('issue key');
    if (!summary && !key) return;

    const row: JiraIssueRow = {
      row: this.issues.length + 1,
      key,
      id: first('issue id'),
      summary,
      issueType: first('issue type'),
      status: first('status'),
      priority: first('priority'),
      resolution: first('resolution'),
      assignee: first('assignee'),
      assigneeId: first('assignee id'),
      reporter: first('reporter'),
      reporterId: first('reporter id'),
      creator: first('creator'),
      creatorId: first('creator id'),
      created: parseJiraDate(first('created')),
      updated: parseJiraDate(first('updated')),
      resolved: parseJiraDate(first('resolved')),
      dueDate: parseJiraDate(first('due date')),
      labels: this.all(cells, 'labels'),
      sprints: this.all(cells, 'sprint'),
      parentRef: first('parent') || first('parent id'),
      epicRef: first('custom field (epic link)'),
      description: (cells[this.descIdx[0] ?? -1] ?? '').trim(),
      storyPoints: parseNumber(this.spIdx.map((i) => (cells[i] ?? '').trim()).find(Boolean) ?? ''),
      comments: this.all(cells, 'comment')
        .map(parseComment)
        .filter((c): c is JiraComment => c !== null),
      timeSpent: parseNumber(first('time spent')),
      originalEstimate: parseNumber(first('original estimate')),
      projectKey: first('project key') || projectKeyOf(key),
    };
    this.issues.push(row);

    if (row.assigneeId && row.assignee) this.accountNames.set(row.assigneeId, row.assignee);
    if (row.reporterId && row.reporter) this.accountNames.set(row.reporterId, row.reporter);
    if (row.creatorId && row.creator) this.accountNames.set(row.creatorId, row.creator);
  }

  result(): JiraParseResult {
    return {
      issues: this.issues,
      unknownColumns: this.unknownColumns,
      accountNames: this.accountNames,
    };
  }
}

/** Parse file CSV export chuẩn của Jira (đồng bộ — giữ cho test/tương thích; server dùng bản async). */
export function parseJiraCsv(input: string | Buffer): JiraParseResult {
  const records = parse(input, CSV_OPTS) as string[][];
  const builder = new JiraRowBuilder((records[0] ?? []).map((h) => h.trim()));
  for (let r = 1; r < records.length; r++) builder.add(records[r]!);
  return builder.result();
}

/**
 * Như `parseJiraCsv` nhưng đọc dạng stream và nhường event loop mỗi 500 dòng, để tệp tới 25MB
 * không làm đứng server (healthcheck/WebSocket vẫn đáp trong lúc parse).
 */
export async function parseJiraCsvAsync(input: string | Buffer): Promise<JiraParseResult> {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  const chunks = function* (): Generator<Buffer> {
    for (let i = 0; i < buf.length; i += STREAM_CHUNK_BYTES)
      yield buf.subarray(i, i + STREAM_CHUNK_BYTES);
  };
  // `pipeline` huỷ nguồn khi parser lỗi/bị huỷ (pipe() thì để nguồn treo); lỗi tới tay ta qua `for await`.
  const parser = streamParse(CSV_OPTS);
  pipeline(Readable.from(chunks(), { objectMode: false }), parser, () => undefined);
  let builder: JiraRowBuilder | null = null;
  let n = 0;
  try {
    for await (const rec of parser as AsyncIterable<string[]>) {
      if (!builder) {
        builder = new JiraRowBuilder(rec.map((h) => h.trim()));
        continue;
      }
      builder.add(rec);
      if (++n % YIELD_EVERY_ROWS === 0) await new Promise<void>((r) => setImmediate(r));
    }
  } finally {
    parser.destroy();
  }
  // Tệp rỗng ⇒ header rỗng ⇒ constructor ném lỗi thiếu cột Summary như bản đồng bộ.
  return (builder ?? new JiraRowBuilder([])).result();
}

/** Tên dùng làm khoá mapping cho một tác giả comment (accountId → tên nếu biết, không thì chính accountId). */
export function commentAuthorName(
  parsed: Pick<JiraParseResult, 'accountNames'>,
  authorRef: string | null,
): string | null {
  if (!authorRef) return null;
  return parsed.accountNames.get(authorRef) ?? authorRef;
}

/** Tóm tắt file để web dựng bảng mapping. Thứ tự giữ theo lần xuất hiện đầu tiên. */
export function analyzeJira(parsed: JiraParseResult): Omit<JiraAnalyzeResult, 'analyzeId'> {
  const uniq = (values: Iterable<string>): string[] => [...new Set([...values].filter(Boolean))];
  const users = new Map<string, { name: string; email?: string }>();
  const addUser = (name: string): void => {
    if (!name || users.has(name)) return;
    users.set(name, name.includes('@') ? { name, email: name } : { name });
  };
  for (const i of parsed.issues) {
    addUser(i.assignee);
    addUser(i.reporter);
    addUser(i.creator);
  }
  for (const i of parsed.issues) {
    for (const c of i.comments) addUser(commentAuthorName(parsed, c.authorRef) ?? '');
  }

  return {
    rows: parsed.issues.length,
    projectKeys: uniq(parsed.issues.map((i) => i.projectKey)),
    issueTypes: uniq(parsed.issues.map((i) => i.issueType)),
    statuses: uniq(parsed.issues.map((i) => i.status)),
    priorities: uniq(parsed.issues.map((i) => i.priority)),
    users: [...users.values()],
    unknownColumns: parsed.unknownColumns,
  };
}
