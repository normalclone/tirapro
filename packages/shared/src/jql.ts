/**
 * JQL-like grammar (tối giản) dùng chung BE (parser->Prisma) và FE (autocomplete).
 *
 * Cú pháp:
 *   <clause> (AND|OR <clause>)*  [ORDER BY <field> (ASC|DESC)?]
 *   <clause> = field operator value | "(" expression ")" | NOT clause
 *   value    = "string" | number | true/false | (v1, v2, ...) | empty | currentUser()
 */

export const JQL_OPERATORS = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  '~', // contains (full-text)
  '!~',
  'IN',
  'NOT IN',
  'IS',
  'IS NOT',
] as const;
export type JqlOperator = (typeof JQL_OPERATORS)[number];

/** Field whitelist: map tên JQL -> metadata để parser sinh Prisma where an toàn. */
export const JQL_FIELDS = {
  project: { type: 'ref', column: 'project.key' },
  type: { type: 'enumRef', column: 'type.name' },
  status: { type: 'enumRef', column: 'status.name' },
  statusCategory: { type: 'enum', column: 'status.category' },
  priority: { type: 'enumRef', column: 'priority.name' },
  assignee: { type: 'user', column: 'assigneeId' },
  reporter: { type: 'user', column: 'reporterId' },
  sprint: { type: 'ref', column: 'sprint.name' },
  labels: { type: 'array', column: 'labels' },
  summary: { type: 'text', column: 'summary' },
  text: { type: 'fulltext', column: 'searchVector' },
  created: { type: 'date', column: 'createdAt' },
  updated: { type: 'date', column: 'updatedAt' },
  due: { type: 'date', column: 'dueDate' },
  resolution: { type: 'enumRef', column: 'resolution.name' },
  storyPoints: { type: 'number', column: 'storyPoints' },
} as const;

export type JqlFieldName = keyof typeof JQL_FIELDS;

/** Hàm mốc thời gian tương đối — compiler giải ra Date lúc chạy truy vấn. */
export const DATE_FUNCTIONS = [
  'now',
  'startOfDay',
  'endOfDay',
  'startOfWeek',
  'endOfWeek',
  'startOfMonth',
  'endOfMonth',
] as const;
export type DateFunctionName = (typeof DATE_FUNCTIONS)[number];

/** Tên hàm hợp lệ trong JQL (currentUser + các mốc thời gian). */
export const JQL_FUNCTIONS = ['currentUser', ...DATE_FUNCTIONS] as const;
export type JqlFunctionName = (typeof JQL_FUNCTIONS)[number];

/** Đơn vị cho ngày tương đối: ngày/tuần/tháng/năm. */
export type RelativeDateUnit = 'd' | 'w' | 'm' | 'y';

export type JqlValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'list'; value: JqlValue[] }
  | { kind: 'function'; name: JqlFunctionName; args: [] }
  | { kind: 'relativeDate'; amount: number; unit: RelativeDateUnit }
  | { kind: 'empty' };

export interface JqlComparison {
  type: 'comparison';
  field: JqlFieldName;
  operator: JqlOperator;
  value: JqlValue;
}

export interface JqlLogical {
  type: 'logical';
  op: 'AND' | 'OR';
  left: JqlNode;
  right: JqlNode;
}

export interface JqlNot {
  type: 'not';
  node: JqlNode;
}

export type JqlNode = JqlComparison | JqlLogical | JqlNot;

export interface JqlOrderBy {
  field: JqlFieldName;
  direction: 'ASC' | 'DESC';
}

export interface JqlQueryAst {
  where: JqlNode | null;
  orderBy: JqlOrderBy[];
}
