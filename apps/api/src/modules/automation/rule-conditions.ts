import type { Prisma } from '@prisma/client';
import type { IssueDto } from '@tirapro/types';
import type { RuleCondition } from '@tirapro/shared';
import { insensitiveContains } from '../../common/like';

export type FieldCondition = Extract<RuleCondition, { field: string }>;
export type JqlCondition = Extract<RuleCondition, { jql: string }>;

export const isJqlCondition = (c: RuleCondition): c is JqlCondition => 'jql' in c;

/** Giá trị trường issue theo tên điều kiện (id cho quan hệ, mảng id cho nhãn). */
function readIssueField(issue: IssueDto, field: FieldCondition['field']): unknown {
  switch (field) {
    case 'statusId':
      return issue.status.id;
    case 'priorityId':
      return issue.priority?.id ?? null;
    case 'assigneeId':
      return issue.assigneeId;
    case 'reporterId':
      return issue.reporterId;
    case 'typeId':
      return issue.type.id;
    case 'sprintId':
      return issue.sprintId;
    case 'resolutionId':
      return issue.resolution?.id ?? null;
    case 'storyPoints':
      return issue.storyPoints;
    case 'summary':
      return issue.summary;
    case 'labelIds':
      return issue.labels.map((l) => l.id);
    case 'dueDate':
      return issue.dueDate ? issue.dueDate.slice(0, 10) : null;
  }
}

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** So sánh "giống nhau" cho số/chuỗi: "5" và 5 coi là bằng nhau (giá trị từ form thường là chuỗi). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const prim = (v: unknown): v is string | number | boolean =>
    ['string', 'number', 'boolean'].includes(typeof v);
  return prim(a) && prim(b) && String(a) === String(b);
}

const asList = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];

/** Đánh giá MỘT điều kiện trường trên issue. Mảng (nhãn): eq/contains = có chứa, in = giao nhau. */
export function evalFieldCondition(issue: IssueDto, c: FieldCondition): boolean {
  const actual = readIssueField(issue, c.field);
  const wanted = c.value;
  const arr = Array.isArray(actual);
  switch (c.op) {
    case 'empty':
      return isEmpty(actual);
    case 'notEmpty':
      return !isEmpty(actual);
    case 'eq':
      return arr
        ? asList(wanted).some((w) => (actual as unknown[]).some((x) => same(x, w)))
        : same(actual, wanted);
    case 'neq':
      return !evalFieldCondition(issue, { ...c, op: 'eq' });
    case 'in': {
      const list = asList(wanted);
      return arr
        ? (actual as unknown[]).some((x) => list.some((w) => same(x, w)))
        : list.some((w) => same(actual, w));
    }
    case 'nin':
      return !evalFieldCondition(issue, { ...c, op: 'in' });
    case 'contains': {
      if (arr) return asList(wanted).some((w) => (actual as unknown[]).some((x) => same(x, w)));
      if (typeof actual !== 'string' || typeof wanted !== 'string') return false;
      return actual.toLowerCase().includes(wanted.toLowerCase());
    }
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Cùng điều kiện, dịch sang `where` Prisma — cho "xem trước số việc khớp" (chạy ở DB thay vì từng issue)  */
/* ------------------------------------------------------------------------------------------------ */

type IssueWhere = Prisma.IssueWhereInput;
type Prim = string | number | boolean;
const isPrim = (v: unknown): v is Prim => ['string', 'number', 'boolean'].includes(typeof v);

/** Không issue nào khớp (Prisma: `OR: []` = tập rỗng). */
const NEVER: IssueWhere = { OR: [] };
/** Mọi issue khớp. */
const ALWAYS: IssueWhere = {};

interface Col {
  kind: 'string' | 'number' | 'date';
  column: string;
  nullable: boolean;
}
const COLUMNS: Record<Exclude<FieldCondition['field'], 'labelIds'>, Col> = {
  statusId: { kind: 'string', column: 'statusId', nullable: false },
  priorityId: { kind: 'string', column: 'priorityId', nullable: true },
  assigneeId: { kind: 'string', column: 'assigneeId', nullable: true },
  reporterId: { kind: 'string', column: 'reporterId', nullable: true },
  typeId: { kind: 'string', column: 'typeId', nullable: false },
  sprintId: { kind: 'string', column: 'sprintId', nullable: true },
  resolutionId: { kind: 'string', column: 'resolutionId', nullable: true },
  storyPoints: { kind: 'number', column: 'storyPoints', nullable: true },
  summary: { kind: 'string', column: 'summary', nullable: false },
  dueDate: { kind: 'date', column: 'dueDate', nullable: true },
};

/** Một giá trị cần so của cột đơn: NULL, hoặc một giá trị đã quy về dạng của cột. */
type Atom =
  | { kind: 'null' }
  | { kind: 'value'; v: string | number }
  | { kind: 'day'; from: Date; to: Date };

/** Ngày dạng `YYYY-MM-DD` hợp lệ → khoảng [00:00, +1 ngày) UTC — engine so 10 ký tự đầu của ISO UTC. */
function dayRange(s: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const from = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== s) return null;
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

/**
 * Giá trị người dùng nhập → cái mà `same(actual, w)` của engine có thể khớp ở cột này; `undefined` = không bao giờ khớp.
 * `same` so `String(a) === String(b)` cho số/chuỗi/boolean, nên: cột chuỗi nhận mọi giá trị nguyên thuỷ (viết ra chữ),
 * cột số chỉ nhận chuỗi/số có dạng chữ CHUẨN của một số ("5" và 5 khớp; "5.0", "05" thì không), cột ngày chỉ nhận
 * chuỗi `YYYY-MM-DD` hợp lệ. `null` khớp cột NULL (`same(null, null)`).
 */
function toAtom(col: Col, w: unknown): Atom | undefined {
  if (w === null) return col.nullable ? { kind: 'null' } : undefined;
  if (!isPrim(w)) return undefined;
  if (col.kind === 'string') return { kind: 'value', v: String(w) };
  if (col.kind === 'number') {
    if (typeof w === 'boolean') return undefined;
    const n = typeof w === 'number' ? w : Number(w);
    return Number.isFinite(n) && String(n) === String(w) ? { kind: 'value', v: n } : undefined;
  }
  const d = typeof w === 'string' ? dayRange(w) : null;
  return d ? { kind: 'day', ...d } : undefined;
}

const atomsOf = (col: Col, list: readonly unknown[]): Atom[] =>
  list.flatMap((w) => {
    const a = toAtom(col, w);
    return a ? [a] : [];
  });

/** Atom → điều kiện "bằng". */
function atomIs(col: Col, a: Atom): IssueWhere {
  if (a.kind === 'null') return { [col.column]: null };
  if (a.kind === 'value') return { [col.column]: a.v };
  return { [col.column]: { gte: a.from, lt: a.to } };
}

/** Atom → phần BÙ chính xác của "bằng" (kể cả NULL: SQL `NOT (col = x)` cho NULL nên phải viết tường minh). */
function atomIsNot(col: Col, a: Atom): IssueWhere {
  if (a.kind === 'null') return { [col.column]: { not: null } };
  const other: IssueWhere[] =
    a.kind === 'value'
      ? [{ [col.column]: { not: a.v } }]
      : [{ [col.column]: { lt: a.from } }, { [col.column]: { gte: a.to } }];
  return col.nullable ? { OR: [{ [col.column]: null }, ...other] } : { OR: other };
}

const anyOf = (col: Col, atoms: Atom[]): IssueWhere =>
  atoms.length ? { OR: atoms.map((a) => atomIs(col, a)) } : NEVER;
const noneOf = (col: Col, atoms: Atom[]): IssueWhere =>
  atoms.length ? { AND: atoms.map((a) => atomIsNot(col, a)) } : ALWAYS;

/** Id nhãn cần so (chữ) — `same(x, w)` của engine với x là id chuỗi. */
const labelIdsOf = (wanted: unknown): string[] => asList(wanted).filter(isPrim).map(String);

function labelWhere(op: FieldCondition['op'], wanted: unknown): IssueWhere {
  const ids = labelIdsOf(wanted);
  const some: IssueWhere = ids.length ? { labels: { some: { labelId: { in: ids } } } } : NEVER;
  const none: IssueWhere = ids.length ? { labels: { none: { labelId: { in: ids } } } } : ALWAYS;
  switch (op) {
    case 'empty':
      return { labels: { none: {} } };
    case 'notEmpty':
      return { labels: { some: {} } };
    case 'eq':
    case 'in':
    case 'contains':
      return some;
    case 'neq':
    case 'nin':
      return none;
  }
}

/**
 * Điều kiện trường → `where` Prisma CHỌN ĐÚNG tập issue mà `evalFieldCondition` cho là thoả (spec đối chứng
 * `rule-conditions.parity.spec.ts` chạy cả hai trên cùng fixture). Trả `null` khi không diễn đạt chính xác được
 * (hiện chỉ `dueDate contains` — engine tìm chuỗi con trong ngày dạng chữ): nơi gọi bỏ qua xem trước, KHÔNG xấp xỉ.
 */
export function fieldConditionToWhere(c: FieldCondition): IssueWhere | null {
  if (c.field === 'labelIds') return labelWhere(c.op, c.value);
  const col = COLUMNS[c.field];
  switch (c.op) {
    case 'empty':
      if (col.kind === 'string')
        return col.nullable
          ? { OR: [{ [col.column]: null }, { [col.column]: '' }] }
          : { [col.column]: '' };
      return { [col.column]: null };
    case 'notEmpty':
      if (col.kind === 'string')
        return col.nullable
          ? { AND: [{ [col.column]: { not: null } }, { [col.column]: { not: '' } }] }
          : { [col.column]: { not: '' } };
      return { [col.column]: { not: null } };
    case 'eq':
      return anyOf(col, Array.isArray(c.value) ? [] : atomsOf(col, [c.value]));
    case 'neq':
      return noneOf(col, Array.isArray(c.value) ? [] : atomsOf(col, [c.value]));
    case 'in':
      return anyOf(col, atomsOf(col, asList(c.value)));
    case 'nin':
      return noneOf(col, atomsOf(col, asList(c.value)));
    case 'contains':
      if (col.kind === 'date') return null; // chuỗi con của "YYYY-MM-DD": không diễn đạt chính xác được
      if (col.kind === 'number' || typeof c.value !== 'string') return NEVER; // engine: chỉ chuỗi-trong-chuỗi
      return { [col.column]: insensitiveContains(c.value) };
  }
}

/** Mô tả ngắn điều kiện đầu tiên không thoả (dùng cho log SKIPPED). */
export function describeCondition(c: RuleCondition): string {
  if (isJqlCondition(c)) return `JQL: ${c.jql}`;
  const v = c.value === undefined ? '' : ` ${JSON.stringify(c.value)}`;
  return `${c.field} ${c.op}${v}`;
}
