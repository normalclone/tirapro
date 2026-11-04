/**
 * Gợi ý tự hoàn thành JQL (lõi thuần, dùng chung web/api): với câu đang gõ + vị trí con trỏ, trả về nên chèn gì
 * (tên trường → toán tử hợp lệ → giá trị thật của workspace → AND/OR/ORDER BY). Không dùng parser vì câu đang gõ
 * chưa hoàn chỉnh — quét token thủ công theo máy trạng thái nhỏ. Danh sách trường/kiểu đọc từ `JQL_FIELDS`,
 * hàm ngày đọc từ `DATE_FUNCTIONS` nên trường mới tự có mặt (chỉ cần thêm mô tả vào `JQL_FIELD_HINTS`).
 */
import { foldForMatch } from './did-you-mean';
import { JQL_FIELDS, type JqlFieldName } from './jql';

/** Danh mục giá trị thật của workspace (tên, đúng như JQL so khớp). */
export interface JqlCatalog {
  statuses: string[];
  types: string[];
  priorities: string[];
  sprints: string[];
  labels: string[];
  resolutions: string[];
  projects: string[];
  /** Mức nghiêm trọng (Q1) — tuỳ chọn để catalog cũ vẫn hợp lệ. */
  severities?: string[];
  /** Thành phần / phiên bản (B17) — tuỳ chọn để catalog cũ vẫn hợp lệ. */
  components?: string[];
  versions?: string[];
}

export interface JqlSuggestion {
  label: string;
  insert: string;
  kind: 'field' | 'operator' | 'value' | 'keyword' | 'function';
  detail?: string;
}

/** Thay `text[from, to)` bằng `item.insert`. */
export interface JqlSuggestResult {
  from: number;
  to: number;
  items: JqlSuggestion[];
}

/** Mô tả tiếng Việt của từng trường — `Record` đầy đủ để compile báo thiếu khi ai đó thêm trường JQL mới. */
export const JQL_FIELD_HINTS: Record<JqlFieldName, string> = {
  project: 'Dự án',
  type: 'Loại công việc',
  status: 'Trạng thái',
  statusCategory: 'Nhóm trạng thái (TODO / IN_PROGRESS / DONE)',
  priority: 'Mức ưu tiên',
  severity: 'Mức nghiêm trọng',
  assignee: 'Người phụ trách',
  reporter: 'Người báo',
  sprint: 'Sprint',
  labels: 'Nhãn',
  component: 'Thành phần',
  fixVersion: 'Phiên bản sửa',
  affectedVersion: 'Phiên bản bị ảnh hưởng',
  key: 'Mã công việc (vd PROJ-STORY-7, hoặc mã Jira JRA-1)',
  summary: 'Tiêu đề',
  text: 'Tìm trong tiêu đề, mô tả và mã',
  created: 'Ngày tạo',
  updated: 'Ngày cập nhật',
  due: 'Hạn hoàn thành',
  resolution: 'Kết luận xử lý',
  storyPoints: 'Điểm',
};

const MAX_ITEMS = 12;
const FIELD_NAMES = Object.keys(JQL_FIELDS) as JqlFieldName[];
/** ORDER BY: bỏ trường mảng/full-text; trường hay sắp xếp lên đầu. */
const ORDER_FIRST: JqlFieldName[] = [
  'created',
  'updated',
  'due',
  'priority',
  'status',
  'storyPoints',
];
const ORDER_FIELDS: JqlFieldName[] = [
  ...ORDER_FIRST,
  ...FIELD_NAMES.filter(
    (f) =>
      !ORDER_FIRST.includes(f) &&
      JQL_FIELDS[f].type !== 'array' &&
      JQL_FIELDS[f].type !== 'fulltext',
  ),
];
const DATE_VALUES = ['startOfWeek()', 'startOfMonth()', 'now()', '-7d', '-30d'];
const STATUS_CATEGORY_VALUES = ['TODO', 'IN_PROGRESS', 'DONE'];
const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IN', 'IS', 'ORDER', 'BY', 'ASC', 'DESC', 'EMPTY']);

// ───────────────────────── token ─────────────────────────

type TokKind = 'str' | 'word' | 'sym' | 'lparen' | 'rparen' | 'comma';
interface Tok {
  kind: TokKind;
  value: string; // str: nội dung không nháy; còn lại: nguyên văn (word viết hoa nếu là từ khoá)
  start: number;
  end: number;
  closed: boolean; // chỉ có nghĩa với str
}

const SYM = /^(!=|>=|<=|!~|=|>|<|~|!)/;

/** Quét `text` (đã cắt tới con trỏ) thành token; chuỗi nháy chưa đóng ở cuối thành token `str` với `closed=false`. */
function lex(text: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i++;
      let buf = '';
      while (i < n && text[i] !== c) {
        if (text[i] === '\\' && i + 1 < n) i++;
        buf += text[i];
        i++;
      }
      const closed = i < n;
      if (closed) i++;
      toks.push({ kind: 'str', value: buf, start, end: i, closed });
      continue;
    }
    if (c === '(') toks.push({ kind: 'lparen', value: c, start: i, end: ++i, closed: true });
    else if (c === ')') toks.push({ kind: 'rparen', value: c, start: i, end: ++i, closed: true });
    else if (c === ',') toks.push({ kind: 'comma', value: c, start: i, end: ++i, closed: true });
    else {
      const sym = SYM.exec(text.slice(i, i + 2));
      if (sym) {
        toks.push({ kind: 'sym', value: sym[1]!, start: i, end: i + sym[1]!.length, closed: true });
        i += sym[1]!.length;
        continue;
      }
      const start = i;
      while (i < n && !/[\s(),=<>!~"']/.test(text[i]!)) i++;
      // hàm có ngoặc rỗng liền sau (now(), currentUser()) gom thành một từ
      if (text.slice(i, i + 2) === '()') i += 2;
      const raw = text.slice(start, i);
      const upper = raw.toUpperCase();
      toks.push({
        kind: 'word',
        value: KEYWORDS.has(upper) ? upper : raw,
        start,
        end: i,
        closed: true,
      });
    }
  }
  return toks;
}

// ───────────────────────── máy trạng thái ─────────────────────────

type State =
  | 'field' // đầu câu / sau AND, OR, NOT, "("
  | 'op' // sau tên trường
  | 'notOp' // sau "NOT" ở vị trí toán tử → chờ IN
  | 'is' // sau IS → EMPTY | NOT
  | 'value' // sau toán tử
  | 'valueList' // sau IN → chờ "("
  | 'listValue' // trong IN ( … → chờ giá trị
  | 'listAfter' // sau một giá trị trong danh sách
  | 'afterValue' // sau giá trị đầy đủ
  | 'orderBy' // sau ORDER → chờ BY
  | 'orderField'
  | 'afterOrderField'
  | 'afterOrderDir';

interface Ctx {
  state: State;
  field: JqlFieldName | null;
  depth: number;
}

const isFieldName = (s: string): s is JqlFieldName =>
  (FIELD_NAMES as string[]).some((f) => f.toLowerCase() === s.toLowerCase());
const canonicalField = (s: string): JqlFieldName =>
  FIELD_NAMES.find((f) => f.toLowerCase() === s.toLowerCase())!;

function step(c: Ctx, t: Tok): Ctx {
  const kw = t.kind === 'word' ? t.value : '';
  switch (c.state) {
    case 'field':
      if (kw === 'NOT') return c;
      if (kw === 'ORDER') return { ...c, state: 'orderBy' };
      if (t.kind === 'lparen') return { ...c, depth: c.depth + 1 };
      if (t.kind === 'word' && isFieldName(t.value))
        return { ...c, state: 'op', field: canonicalField(t.value) };
      if (t.kind === 'word' || t.kind === 'str') return { ...c, state: 'op', field: null };
      return c;
    case 'op':
      if (t.kind === 'sym') return { ...c, state: 'value' };
      if (kw === 'IN') return { ...c, state: 'valueList' };
      if (kw === 'NOT') return { ...c, state: 'notOp' };
      if (kw === 'IS') return { ...c, state: 'is' };
      return c;
    case 'notOp':
      return kw === 'IN' ? { ...c, state: 'valueList' } : c;
    case 'is':
      if (kw === 'NOT') return { ...c, state: 'value', field: null };
      return { ...c, state: 'afterValue' };
    case 'value':
      if (t.kind === 'word' || t.kind === 'str') return { ...c, state: 'afterValue' };
      return c;
    case 'valueList':
      return t.kind === 'lparen' ? { ...c, state: 'listValue' } : c;
    case 'listValue':
      if (t.kind === 'word' || t.kind === 'str') return { ...c, state: 'listAfter' };
      if (t.kind === 'rparen') return { ...c, state: 'afterValue' };
      return c;
    case 'listAfter':
      if (t.kind === 'comma') return { ...c, state: 'listValue' };
      if (t.kind === 'rparen') return { ...c, state: 'afterValue' };
      return c;
    case 'afterValue':
      if (kw === 'AND' || kw === 'OR') return { ...c, state: 'field', field: null };
      if (kw === 'ORDER') return { ...c, state: 'orderBy' };
      if (t.kind === 'rparen') return { ...c, depth: Math.max(0, c.depth - 1) };
      return c;
    case 'orderBy':
      return kw === 'BY' ? { ...c, state: 'orderField' } : c;
    case 'orderField':
      return t.kind === 'word' ? { ...c, state: 'afterOrderField' } : c;
    case 'afterOrderField':
      if (kw === 'ASC' || kw === 'DESC') return { ...c, state: 'afterOrderDir' };
      if (t.kind === 'comma') return { ...c, state: 'orderField' };
      return c;
    case 'afterOrderDir':
      return t.kind === 'comma' ? { ...c, state: 'orderField' } : c;
  }
}

// ───────────────────────── gợi ý ─────────────────────────

const operatorsFor = (field: JqlFieldName | null): string[] => {
  const type = field ? JQL_FIELDS[field].type : null;
  if (type === 'text' || type === 'fulltext') return ['~', '!~', '=', '!='];
  if (type === 'number' || type === 'date') return ['=', '!=', '>', '>=', '<', '<='];
  return ['=', '!=', 'IN', 'NOT IN', 'IS', 'IS NOT'];
};

/** Bare word hợp lệ trong JQL? Không thì phải bọc nháy kép (có khoảng trắng, ký tự đặc biệt, từ khoá, số trần). */
function needsQuote(v: string): boolean {
  return (
    !/^[\p{L}\p{N}_.\-+:@]+$/u.test(v) || KEYWORDS.has(v.toUpperCase()) || /^-?\d+(\.\d+)?$/.test(v)
  );
}
const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Giá trị viết vào JQL: bare word nếu được, ngược lại bọc nháy kép (đã escape). */
export function jqlLiteral(v: string): string {
  return needsQuote(v) ? quote(v) : v;
}

function catalogValues(field: JqlFieldName, cat: JqlCatalog): JqlSuggestion[] | null {
  const vals = (xs: string[] | undefined): JqlSuggestion[] =>
    (xs ?? []).map((x) => ({ label: x, insert: x, kind: 'value' as const }));
  switch (field) {
    case 'status':
      return vals(cat.statuses);
    case 'type':
      return vals(cat.types);
    case 'priority':
      return vals(cat.priorities);
    case 'severity':
      return vals(cat.severities);
    case 'resolution':
      return vals(cat.resolutions);
    case 'sprint':
      return vals(cat.sprints);
    case 'project':
      return vals(cat.projects);
    case 'labels':
      return vals(cat.labels);
    case 'component':
      return vals(cat.components);
    case 'fixVersion':
    case 'affectedVersion':
      return vals(cat.versions);
    default:
      return null;
  }
}

function valueItems(field: JqlFieldName | null, cat: JqlCatalog): JqlSuggestion[] {
  if (!field) return [];
  const type = JQL_FIELDS[field].type;
  const detail = JQL_FIELD_HINTS[field];
  const fixed = (xs: string[], kind: JqlSuggestion['kind'] = 'value'): JqlSuggestion[] =>
    xs.map((x) => ({ label: x, insert: x, kind, detail }));
  const fromCatalog = catalogValues(field, cat);
  if (fromCatalog) return fromCatalog.map((s) => ({ ...s, detail }));
  if (type === 'user') {
    return [
      { label: 'me', insert: 'me', kind: 'value', detail: 'Chính bạn' },
      { label: 'currentUser()', insert: 'currentUser()', kind: 'function', detail: 'Chính bạn' },
    ];
  }
  if (type === 'date') {
    return DATE_VALUES.map((x) => ({
      label: x,
      insert: x,
      kind: x.endsWith(')') ? ('function' as const) : ('value' as const),
      detail: x.startsWith('-') ? `${x.slice(1, -1)} ngày trước` : detail,
    }));
  }
  if (field === 'statusCategory') return fixed(STATUS_CATEGORY_VALUES);
  return []; // summary / text / storyPoints …: gõ tự do
}

const kw = (label: string, detail?: string): JqlSuggestion => ({
  label,
  insert: label,
  kind: 'keyword',
  detail,
});

function itemsFor(c: Ctx, cat: JqlCatalog, isIsValue: boolean, quoted: boolean): JqlSuggestion[] {
  switch (c.state) {
    case 'field':
      return [
        ...FIELD_NAMES.map((f) => ({
          label: f,
          insert: f,
          kind: 'field' as const,
          detail: JQL_FIELD_HINTS[f],
        })),
        kw('NOT', 'Phủ định điều kiện'),
        { label: '(', insert: '(', kind: 'keyword', detail: 'Mở nhóm điều kiện' },
      ];
    case 'orderField':
      return ORDER_FIELDS.map((f) => ({
        label: f,
        insert: f,
        kind: 'field' as const,
        detail: JQL_FIELD_HINTS[f],
      }));
    case 'op':
      return operatorsFor(c.field).map((o) => ({ label: o, insert: o, kind: 'operator' as const }));
    case 'notOp':
      return [{ label: 'IN', insert: 'IN', kind: 'operator' }];
    case 'is':
      return [
        { label: 'EMPTY', insert: 'EMPTY', kind: 'value', detail: 'Chưa có giá trị' },
        { label: 'NOT', insert: 'NOT', kind: 'operator' },
      ];
    case 'value':
    case 'listValue': {
      if (isIsValue)
        return [{ label: 'EMPTY', insert: 'EMPTY', kind: 'value', detail: 'Chưa có giá trị' }];
      const items = valueItems(c.field, cat);
      // đang trong nháy → giữ nháy cho mọi giá trị
      return items.map((i) =>
        i.kind === 'value' && (quoted || needsQuote(i.insert))
          ? { ...i, insert: quote(i.insert) }
          : i,
      );
    }
    case 'valueList':
      return [{ label: '(', insert: '(', kind: 'keyword', detail: 'Mở danh sách giá trị' }];
    case 'listAfter':
      return [
        { label: ',', insert: ',', kind: 'keyword', detail: 'Thêm giá trị' },
        { label: ')', insert: ')', kind: 'keyword', detail: 'Đóng danh sách' },
      ];
    case 'afterValue':
      return [
        kw('AND', 'Và'),
        kw('OR', 'Hoặc'),
        kw('ORDER BY', 'Sắp xếp kết quả'),
        ...(c.depth > 0
          ? [{ label: ')', insert: ')', kind: 'keyword' as const, detail: 'Đóng nhóm' }]
          : []),
      ];
    case 'orderBy':
      return [kw('BY')];
    case 'afterOrderField':
      return [kw('ASC', 'Tăng dần'), kw('DESC', 'Giảm dần')];
    case 'afterOrderDir':
      return [];
  }
}

/** `item.insert` được lọc theo tiền tố của phần đang gõ (không phân biệt hoa thường/dấu; bỏ nháy đầu). */
function matchesPrefix(item: JqlSuggestion, prefix: string): boolean {
  if (!prefix) return true;
  const target = foldForMatch(item.label);
  return target.startsWith(prefix);
}

export function suggestJql(text: string, caret: number, catalog: JqlCatalog): JqlSuggestResult {
  const pos = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, pos);
  const toks = lex(before);
  const empty: JqlSuggestResult = { from: pos, to: pos, items: [] };

  // Token cuối chạm con trỏ = phần đang gõ (từ, nháy chưa đóng, hoặc ký hiệu toán tử dở).
  let partial: Tok | null = null;
  const last = toks[toks.length - 1];
  if (last && last.end === pos) {
    if (last.kind === 'word' || last.kind === 'sym' || (last.kind === 'str' && !last.closed))
      partial = last;
    // chuỗi đã đóng / ")" dính con trỏ: chèn gì vào cũng dính liền → không gợi ý
    else if (last.kind === 'rparen' || last.kind === 'str') return empty;
  }
  const done = partial ? toks.slice(0, -1) : toks;

  let ctx: Ctx = { state: 'field', field: null, depth: 0 };
  let isIsValue = false;
  for (const t of done) {
    const prev = ctx.state;
    ctx = step(ctx, t);
    if (t.kind === 'word' && t.value === 'NOT' && prev === 'is') isIsValue = true;
    else if (ctx.state !== 'value') isIsValue = false;
  }

  // Trường chữ tự do (summary/text) hoặc trường không có danh mục: không gợi ý trong nháy chưa đóng.
  const quoted = partial?.kind === 'str';
  if (quoted && !(ctx.state === 'value' || ctx.state === 'listValue')) return empty;

  const raw = partial?.value ?? '';
  const prefix = foldForMatch(raw);
  const from = partial ? partial.start : pos;
  let to = pos;
  if (partial?.kind === 'str') {
    // con trỏ nằm TRONG chuỗi nháy đã đóng (`status = "In|"`) → thay luôn phần còn lại và nháy đóng
    const open = text[partial.start]!;
    const rest = text.slice(pos);
    const close = rest.indexOf(open);
    const next = rest[close + 1];
    const endsValue = next === undefined || /[\s),]/.test(next);
    if (close >= 0 && endsValue && !rest.slice(0, close).includes('\\')) to = pos + close + 1;
  } else if (partial?.kind === 'word') {
    // con trỏ nằm giữa từ → thay cả phần còn lại của từ
    const m = /^[^\s(),=<>!~"']*/.exec(text.slice(pos));
    to = pos + (m ? m[0].length : 0);
  }

  const items = itemsFor(ctx, catalog, isIsValue, quoted)
    .filter((i) => matchesPrefix(i, prefix))
    .slice(0, MAX_ITEMS);
  return { from, to, items };
}
