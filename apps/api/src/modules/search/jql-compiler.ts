import { Prisma } from '@prisma/client';
import type { JqlFieldName, JqlNode, JqlOperator, JqlOrderBy, JqlQueryAst, JqlValue } from '@tirapro/shared';

export interface JqlCompileContext {
  currentUserId: string;
}

interface FieldCfg {
  kind: 'relationName' | 'idUser' | 'enumRel' | 'text' | 'fulltext' | 'array' | 'date' | 'number';
  relation?: string; // tên relation Prisma
  field?: string; // cột bên trong relation (name/key/category)
  idColumn?: string; // cột FK để xử lý IS EMPTY trực tiếp
  column?: string; // cột scalar (summary/createdAt/storyPoints...)
}

/** Map field JQL → cách dựng Prisma where (an toàn, whitelist). */
const FIELD_MAP: Record<JqlFieldName, FieldCfg> = {
  project: { kind: 'relationName', relation: 'project', field: 'key' },
  type: { kind: 'relationName', relation: 'type', field: 'name', idColumn: 'typeId' },
  status: { kind: 'relationName', relation: 'status', field: 'name', idColumn: 'statusId' },
  statusCategory: { kind: 'enumRel', relation: 'status', field: 'category' },
  priority: { kind: 'relationName', relation: 'priority', field: 'name', idColumn: 'priorityId' },
  assignee: { kind: 'idUser', idColumn: 'assigneeId' },
  reporter: { kind: 'idUser', idColumn: 'reporterId' },
  sprint: { kind: 'relationName', relation: 'sprint', field: 'name', idColumn: 'sprintId' },
  labels: { kind: 'array' },
  summary: { kind: 'text', column: 'summary' },
  text: { kind: 'fulltext' },
  created: { kind: 'date', column: 'createdAt' },
  updated: { kind: 'date', column: 'updatedAt' },
  due: { kind: 'date', column: 'dueDate' },
  resolution: { kind: 'relationName', relation: 'resolution', field: 'name', idColumn: 'resolutionId' },
  storyPoints: { kind: 'number', column: 'storyPoints' },
};

type Where = Prisma.IssueWhereInput;

export function compileJql(ast: JqlQueryAst, ctx: JqlCompileContext): { where: Where; orderBy: Prisma.IssueOrderByWithRelationInput[] } {
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
    return { [cfg.relation!]: { [cfg.field!]: dir } } as Prisma.IssueOrderByWithRelationInput;
  }
  if (cfg.kind === 'idUser') return { [cfg.idColumn!]: dir } as Prisma.IssueOrderByWithRelationInput;
  if (cfg.column) return { [cfg.column]: dir } as Prisma.IssueOrderByWithRelationInput;
  return { updatedAt: dir };
}

function compileComparison(field: JqlFieldName, op: JqlOperator, value: JqlValue, ctx: JqlCompileContext): Where {
  const cfg = FIELD_MAP[field];
  switch (cfg.kind) {
    case 'relationName':
    case 'enumRel': {
      if (op === 'IS') return cfg.idColumn ? { [cfg.idColumn]: null } : { [cfg.relation!]: { is: null } };
      if (op === 'IS NOT') return cfg.idColumn ? { NOT: { [cfg.idColumn]: null } } : { [cfg.relation!]: { isNot: null } };
      const f = stringFilter(op, value, ctx);
      return { [cfg.relation!]: { [cfg.field!]: f } } as Where;
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
      if (op === '~') return { [col]: { contains: v, mode: 'insensitive' } } as Where;
      if (op === '!~') return { NOT: { [col]: { contains: v, mode: 'insensitive' } } } as Where;
      if (op === '!=') return { [col]: { not: v } } as Where;
      return { [col]: v } as Where;
    }
    case 'fulltext': {
      const v = scalarString(value, ctx);
      const like = { contains: v, mode: 'insensitive' as const };
      const match: Where = { OR: [{ summary: like }, { description: like }] };
      return op === '!~' ? { NOT: match } : match;
    }
    case 'array': {
      // labels
      if (op === 'IS') return { labels: { none: {} } };
      if (op === 'IS NOT') return { labels: { some: {} } };
      const names = op === 'IN' || op === 'NOT IN' ? listStrings(value, ctx) : [scalarString(value, ctx)];
      const rel = { label: { name: { in: names } } };
      return op === 'NOT IN' || op === '!=' ? { labels: { none: rel } } : { labels: { some: rel } };
    }
    case 'date': {
      const col = cfg.column!;
      if (op === 'IS') return { [col]: null };
      if (op === 'IS NOT') return { NOT: { [col]: null } };
      const d = resolveDateValue(value, ctx);
      const cmp = dateCmp(op, d);
      return { [col]: cmp } as Where;
    }
    case 'number': {
      const col = cfg.column!;
      if (op === 'IS') return { [col]: null };
      if (op === 'IS NOT') return { NOT: { [col]: null } };
      if (op === 'IN') return { [col]: { in: listNumbers(value) } };
      if (op === 'NOT IN') return { [col]: { notIn: listNumbers(value) } };
      const num = scalarNumber(value);
      return { [col]: numCmp(op, num) } as Where;
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

function stringFilter(op: JqlOperator, value: JqlValue, ctx: JqlCompileContext): Prisma.StringFilter | string {
  if (op === 'IN') return { in: listStrings(value, ctx) };
  if (op === 'NOT IN') return { notIn: listStrings(value, ctx) };
  const v = scalarString(value, ctx);
  if (op === '~') return { contains: v, mode: 'insensitive' };
  if (op === '!~') return { not: { contains: v } };
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
