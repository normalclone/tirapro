import type { Prisma } from '@prisma/client';
import { escapeLike, insensitiveContains } from '../../common/like';
import type {
  JqlFieldName,
  JqlNode,
  JqlOperator,
  JqlOrderBy,
  JqlQueryAst,
  JqlValue,
} from '@tirapro/shared';

export interface JqlCompileContext {
  currentUserId: string;
  /**
   * Kết quả full-text đã tra sẵn cho từng giá trị của `text ~ "..."` (giá trị → danh sách id theo rank).
   * Không có entry (vd cột searchVector chưa tồn tại) → rơi về `contains` trên summary/description.
   */
  fulltext?: ReadonlyMap<string, readonly string[]>;
}

/** Các giá trị `text ~ "..."` (toán tử `~`, không rỗng) trong cây điều kiện — để tra full-text trước khi compile. */
export function collectFulltextTerms(node: JqlNode | null): string[] {
  const out = new Set<string>();
  const walk = (n: JqlNode): void => {
    if (n.type === 'logical') {
      walk(n.left);
      walk(n.right);
    } else if (n.type === 'not') {
      walk(n.node);
    } else if (
      n.field === 'text' &&
      n.operator === '~' &&
      n.value.kind === 'string' &&
      n.value.value.trim()
    ) {
      out.add(n.value.value);
    }
  };
  if (node) walk(node);
  return [...out];
}

/**
 * Giá trị `text ~ "..."` nằm trên chuỗi AND thuần của điều kiện (không qua OR/NOT) — khi đó mọi kết quả
 * đều thuộc tập id full-text nên có thể xếp theo rank. null nếu không có.
 */
export function primaryFulltextTerm(node: JqlNode | null): string | null {
  const walk = (n: JqlNode): string | null => {
    if (n.type === 'logical') return n.op === 'AND' ? (walk(n.left) ?? walk(n.right)) : null;
    if (n.type === 'not') return null;
    return n.field === 'text' &&
      n.operator === '~' &&
      n.value.kind === 'string' &&
      n.value.value.trim()
      ? n.value.value
      : null;
  };
  return node ? walk(node) : null;
}

/** Khoá project của điều kiện `project = X` / `project IN (…)` nằm trên chuỗi AND thuần (không qua OR/NOT); null nếu không có. */
export function topLevelProjectKeys(node: JqlNode | null): string[] | null {
  const walk = (n: JqlNode): string[] | null => {
    if (n.type === 'logical') return n.op === 'AND' ? (walk(n.left) ?? walk(n.right)) : null;
    if (n.type === 'not') return null;
    if (n.field !== 'project' || (n.operator !== '=' && n.operator !== 'IN')) return null;
    const vs = n.value.kind === 'list' ? n.value.value : [n.value];
    const keys = vs.flatMap((x) => (x.kind === 'string' ? [x.value] : []));
    return keys.length ? keys : null;
  };
  return node ? walk(node) : null;
}

interface FieldCfg {
  kind: 'relationName' | 'idUser' | 'enumRel' | 'text' | 'fulltext' | 'array' | 'date' | 'number';
  relation?: string; // tên relation Prisma
  field?: string; // cột bên trong relation (name/key/category)
  idColumn?: string; // cột FK để xử lý IS EMPTY trực tiếp
  column?: string; // cột scalar (summary/createdAt/storyPoints...)
  relNullable?: boolean; // quan hệ cho phép không có (priority/sprint/resolution) — `!~` phải gồm cả issue không có quan hệ
  nullable?: boolean; // cột scalar cho phép NULL (ảnh hưởng cách dựng `contains`, xem containsWhere)
}

/** Map field JQL → cách dựng Prisma where (an toàn, whitelist). */
const FIELD_MAP: Record<JqlFieldName, FieldCfg> = {
  project: { kind: 'relationName', relation: 'project', field: 'key' },
  type: { kind: 'relationName', relation: 'type', field: 'name', idColumn: 'typeId' },
  status: { kind: 'relationName', relation: 'status', field: 'name', idColumn: 'statusId' },
  statusCategory: { kind: 'enumRel', relation: 'status', field: 'category' },
  priority: {
    kind: 'relationName',
    relation: 'priority',
    field: 'name',
    idColumn: 'priorityId',
    relNullable: true,
  },
  assignee: { kind: 'idUser', idColumn: 'assigneeId' },
  reporter: { kind: 'idUser', idColumn: 'reporterId' },
  sprint: {
    kind: 'relationName',
    relation: 'sprint',
    field: 'name',
    idColumn: 'sprintId',
    relNullable: true,
  },
  labels: { kind: 'array' },
  summary: { kind: 'text', column: 'summary' },
  text: { kind: 'fulltext' },
  created: { kind: 'date', column: 'createdAt' },
  updated: { kind: 'date', column: 'updatedAt' },
  due: { kind: 'date', column: 'dueDate' },
  resolution: {
    kind: 'relationName',
    relation: 'resolution',
    field: 'name',
    idColumn: 'resolutionId',
    relNullable: true,
  },
  storyPoints: { kind: 'number', column: 'storyPoints' },
};

type Where = Prisma.IssueWhereInput;

export function compileJql(
  ast: JqlQueryAst,
  ctx: JqlCompileContext,
): { where: Where; orderBy: Prisma.IssueOrderByWithRelationInput[] } {
  return {
    where: ast.where ? compileNode(ast.where, ctx) : {},
    orderBy: ast.orderBy.map((o) => compileOrder(o)),
  };
}

function compileNode(node: JqlNode, ctx: JqlCompileContext): Where {
  if (node.type === 'logical') {
    const left = compileNode(node.left, ctx);
    const right = compileNode(node.right, ctx);
    return node.op === 'AND' ? { AND: [left, right] } : { OR: [left, right] };
  }
  if (node.type === 'not') {
    return { NOT: compileNode(node.node, ctx) };
  }
  return compileComparison(node.field, node.operator, node.value, ctx);
}

function compileOrder(o: JqlOrderBy): Prisma.IssueOrderByWithRelationInput {
  const cfg = FIELD_MAP[o.field];
  const dir = o.direction === 'DESC' ? 'desc' : 'asc';
  if (cfg.kind === 'relationName' || cfg.kind === 'enumRel') {
    return { [cfg.relation!]: { [cfg.field!]: dir } };
  }
  if (cfg.kind === 'idUser') return { [cfg.idColumn!]: dir };
  if (cfg.column) return { [cfg.column]: dir };
  return { updatedAt: dir };
}

/** Bộ lọc chuỗi con không phân biệt hoa thường, đã escape ký tự đại diện — dùng chung cho mọi toán tử `~`/`!~`. */
const likeFilter = insensitiveContains;

/**
 * `column contains v` (đã escape) mà KHÔNG BAO GIỜ cho NULL: cột nullable được chặn bằng `not: null`
 * (`NULL ILIKE …` là NULL, và `NOT NULL` vẫn là NULL => issue có giá trị NULL bị rơi khỏi phép phủ định).
 * Nhờ vậy `NOT (…)` quanh nó (`!~`, `NOT (…)`, NOT bọc nhiều điều kiện) luôn là phần bù đúng.
 */
export function containsWhere(column: string, v: string, nullable = false): Where {
  const match: Where = { [column]: likeFilter(v) };
  return nullable ? { AND: [{ [column]: { not: null } }, match] } : match;
}

/**
 * Điều kiện Prisma ĐẦY ĐỦ cho `text ~ v`: id full-text đã xếp hạng (nếu có) HOẶC chuỗi con ở
 * summary/description/key. Đúng đắn không phụ thuộc danh sách xếp hạng (vốn bị cắt top-N);
 * danh sách đó chỉ giúp bắt token khác dạng mà `contains` không thấy và để xếp hạng (rankHint).
 * Không bao giờ cho NULL (xem `containsWhere`; `description` nullable).
 */
function textMatchWhere(v: string, ranked?: readonly string[]): Where {
  return {
    OR: [
      ...(ranked?.length ? [{ id: { in: [...ranked] } }] : []),
      containsWhere('summary', v),
      containsWhere('description', v, true),
      containsWhere('key', v),
    ],
  };
}

function compileComparison(
  field: JqlFieldName,
  op: JqlOperator,
  value: JqlValue,
  ctx: JqlCompileContext,
): Where {
  const cfg = FIELD_MAP[field];
  switch (cfg.kind) {
    case 'relationName':
    case 'enumRel': {
      if (op === 'IS')
        return cfg.idColumn ? { [cfg.idColumn]: null } : { [cfg.relation!]: { is: null } };
      if (op === 'IS NOT')
        return cfg.idColumn
          ? { NOT: { [cfg.idColumn]: null } }
          : { [cfg.relation!]: { isNot: null } };
      const f = stringFilter(op, value, ctx);
      const rel: Where = { [cfg.relation!]: { [cfg.field!]: f } };
      // `rel.name NOT ILIKE …` không bao giờ đúng với issue KHÔNG có quan hệ (JOIN ra NULL) ⇒ `!~` bỏ sót
      // issue ở backlog / chưa có priority / chưa có resolution. Thêm nhánh "không có quan hệ" để `!~` là phần bù đúng của `~`.
      if (op === '!~' && cfg.relNullable && cfg.idColumn)
        return { OR: [{ [cfg.idColumn]: null }, rel] };
      return rel;
    }
    case 'idUser': {
      const col = cfg.idColumn!;
      if (op === 'IS') return { [col]: null };
      if (op === 'IS NOT') return { NOT: { [col]: null } };
      if (op === 'IN') return { [col]: { in: listStrings(value, ctx) } };
      if (op === 'NOT IN') return { [col]: { notIn: listStrings(value, ctx) } };
      const v = scalarString(value, ctx);
      if (op === '!=') return { [col]: { not: v } };
      return { [col]: v };
    }
    case 'text': {
      const col = cfg.column!;
      const v = scalarString(value, ctx);
      if (op === '~') return containsWhere(col, v, cfg.nullable);
      if (op === '!~') return { NOT: containsWhere(col, v, cfg.nullable) };
      if (op === '!=') return { [col]: { not: v } };
      return { [col]: v };
    }
    case 'fulltext': {
      const v = scalarString(value, ctx);
      // `!~` dùng cùng tập xếp hạng (nếu `text ~ v` cũng có trong truy vấn) để hai vế là phần bù chính xác.
      const match = textMatchWhere(v, ctx.fulltext?.get(v));
      return op === '!~' ? { NOT: match } : match;
    }
    case 'array': {
      // labels
      if (op === 'IS') return { labels: { none: {} } };
      if (op === 'IS NOT') return { labels: { some: {} } };
      const names =
        op === 'IN' || op === 'NOT IN' ? listStrings(value, ctx) : [scalarString(value, ctx)];
      const rel = { label: { name: { in: names } } };
      return op === 'NOT IN' || op === '!=' ? { labels: { none: rel } } : { labels: { some: rel } };
    }
    case 'date': {
      const col = cfg.column!;
      if (op === 'IS') return { [col]: null };
      if (op === 'IS NOT') return { NOT: { [col]: null } };
      const d = resolveDateValue(value, ctx);
      const cmp = dateCmp(op, d);
      return { [col]: cmp };
    }
    case 'number': {
      const col = cfg.column!;
      if (op === 'IS') return { [col]: null };
      if (op === 'IS NOT') return { NOT: { [col]: null } };
      if (op === 'IN') return { [col]: { in: listNumbers(value) } };
      if (op === 'NOT IN') return { [col]: { notIn: listNumbers(value) } };
      const num = scalarNumber(value);
      return { [col]: numCmp(op, num) };
    }
    default:
      return {};
  }
}

// ---------- helpers ----------
function scalarString(v: JqlValue, ctx: JqlCompileContext): string {
  if (v.kind === 'function' && v.name === 'currentUser') return ctx.currentUserId;
  if (v.kind === 'string') return v.value;
  if (v.kind === 'number') return String(v.value);
  if (v.kind === 'bool') return String(v.value);
  // Ngày tương đối dùng ở field không phải date → suy biến về token gốc (hiếm).
  if (v.kind === 'relativeDate') return `${v.amount}${v.unit}`;
  return '';
}

/** Giải giá trị ngày: tương đối (-7d), mốc (startOfWeek()), hoặc ngày tuyệt đối. */
function resolveDateValue(v: JqlValue, ctx: JqlCompileContext): Date {
  if (v.kind === 'relativeDate') return applyOffset(new Date(), v.amount, v.unit);
  if (v.kind === 'function' && v.name !== 'currentUser') return resolveDateAnchor(v.name);
  return new Date(scalarString(v, ctx));
}

function applyOffset(base: Date, amount: number, unit: 'd' | 'w' | 'm' | 'y'): Date {
  const d = new Date(base);
  if (unit === 'd') d.setDate(d.getDate() + amount);
  else if (unit === 'w') d.setDate(d.getDate() + amount * 7);
  else if (unit === 'm') d.setMonth(d.getMonth() + amount);
  else d.setFullYear(d.getFullYear() + amount);
  return d;
}

/** Mốc thời gian (tuần bắt đầu từ Thứ Hai). */
function resolveDateAnchor(name: string): Date {
  const now = new Date();
  switch (name) {
    case 'startOfDay': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'endOfDay': {
      const d = new Date(now);
      d.setHours(23, 59, 59, 999);
      return d;
    }
    case 'startOfWeek': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return d;
    }
    case 'endOfWeek': {
      const d = resolveDateAnchor('startOfWeek');
      d.setDate(d.getDate() + 6);
      d.setHours(23, 59, 59, 999);
      return d;
    }
    case 'startOfMonth':
      return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    case 'endOfMonth':
      return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    default: // 'now'
      return now;
  }
}

function scalarNumber(v: JqlValue): number {
  if (v.kind === 'number') return v.value;
  if (v.kind === 'string') return Number(v.value);
  return NaN;
}

function listStrings(v: JqlValue, ctx: JqlCompileContext): string[] {
  if (v.kind === 'list') return v.value.map((x) => scalarString(x, ctx));
  return [scalarString(v, ctx)];
}

function listNumbers(v: JqlValue): number[] {
  if (v.kind === 'list') return v.value.map((x) => scalarNumber(x));
  return [scalarNumber(v)];
}

function stringFilter(
  op: JqlOperator,
  value: JqlValue,
  ctx: JqlCompileContext,
): Prisma.StringFilter | string {
  if (op === 'IN') return { in: listStrings(value, ctx) };
  if (op === 'NOT IN') return { notIn: listStrings(value, ctx) };
  const v = scalarString(value, ctx);
  if (op === '~') return likeFilter(v);
  if (op === '!~') return { not: { contains: escapeLike(v) }, mode: 'insensitive' };
  if (op === '!=') return { not: v };
  return v;
}

function dateCmp(op: JqlOperator, d: Date): Prisma.DateTimeNullableFilter {
  switch (op) {
    case '>':
      return { gt: d };
    case '>=':
      return { gte: d };
    case '<':
      return { lt: d };
    case '<=':
      return { lte: d };
    case '!=':
      return { not: d };
    default:
      return { equals: d };
  }
}

function numCmp(op: JqlOperator, n: number): Prisma.FloatNullableFilter {
  switch (op) {
    case '>':
      return { gt: n };
    case '>=':
      return { gte: n };
    case '<':
      return { lt: n };
    case '<=':
      return { lte: n };
    case '!=':
      return { not: n };
    default:
      return { equals: n };
  }
}
