/**
 * Cầu nối giữa bộ dựng truy vấn trực quan ("đơn giản") và chuỗi JQL.
 *
 * - `serializeSimpleQuery`  : SimpleQuery → chuỗi JQL hợp lệ (khớp grammar ở jql-parser).
 * - `tryParseToSimpleQuery` : chuỗi JQL → SimpleQuery, hoặc `null` nếu quá phức tạp cho
 *   chế độ đơn giản (nhóm lồng nhau, trộn AND/OR, NOT, hoặc nhiều ORDER BY).
 *
 * Cả hai thuần hàm, dùng chung để FE sinh JQL còn người dùng đại trà không phải gõ tay.
 */
import { JQL_FIELDS, type JqlFieldName, type JqlValue } from './jql';
import { JqlParseError, parseJql } from './jql-parser';
import type { JqlNode, JqlComparison, JqlOrderBy } from './jql';

/** Toán tử mà bộ dựng trực quan hỗ trợ (tập con thân thiện của JQL_OPERATORS). */
export type BuilderOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | '~'
  | '!~'
  | 'IN'
  | 'NOT IN'
  | 'IS'
  | 'IS NOT';

/** Sentinel cho currentUser() trong danh sách giá trị (field user). */
export const CURRENT_USER_TOKEN = '@me';

export interface SimpleCondition {
  /** Khoá cục bộ để React render ổn định (không ảnh hưởng JQL). */
  id: string;
  field: JqlFieldName;
  operator: BuilderOperator;
  /** Giá trị đã chọn. IN/NOT IN: nhiều; so sánh đơn: phần tử đầu; IS/IS NOT: rỗng. */
  values: string[];
}

export interface SimpleSort {
  field: JqlFieldName;
  direction: 'ASC' | 'DESC';
}

export interface SimpleQuery {
  combinator: 'AND' | 'OR';
  conditions: SimpleCondition[];
  sort: SimpleSort | null;
}

/** Loại dữ liệu của field (lấy từ whitelist JQL_FIELDS). */
export function jqlFieldType(field: JqlFieldName): string {
  return JQL_FIELDS[field].type;
}

/** Field thuộc nhóm phân loại (chọn từ danh sách): ref/enumRef/enum/user/array. */
export function isCategoricalField(field: JqlFieldName): boolean {
  const t = jqlFieldType(field);
  return t === 'ref' || t === 'enumRef' || t === 'enum' || t === 'user' || t === 'array';
}

/* ------------------------------------------------------------------ */
/* Serialize: SimpleQuery → JQL                                        */
/* ------------------------------------------------------------------ */

function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Bareword số nguyên/thực (không cần nháy). */
function isNumeric(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s.trim());
}

/** Token ngày tương đối (-7d, 30d) hoặc hàm mốc (startOfWeek()). */
export function isRelativeDateToken(raw: string): boolean {
  const s = raw.trim();
  return /^[+-]?\d+[dwmy]$/i.test(s) || /^[a-zA-Z]+\(\)$/.test(s);
}

/** Một giá trị → token JQL (currentUser(), ngày tương đối, số trần, hoặc chuỗi có nháy). */
function serializeValue(field: JqlFieldName, raw: string): string {
  if (raw === CURRENT_USER_TOKEN) return 'currentUser()';
  const t = jqlFieldType(field);
  if (t === 'date' && isRelativeDateToken(raw)) return raw.trim();
  if (t === 'number' && isNumeric(raw)) return raw.trim();
  return quote(raw);
}

/** Điều kiện đã đủ dữ liệu để sinh JQL chưa? */
export function isConditionComplete(c: SimpleCondition): boolean {
  if (c.operator === 'IS' || c.operator === 'IS NOT') return true;
  if (c.operator === 'IN' || c.operator === 'NOT IN') return c.values.length > 0;
  return c.values.length > 0 && c.values[0].trim() !== '';
}

function serializeCondition(c: SimpleCondition): string {
  if (c.operator === 'IS') return `${c.field} IS EMPTY`;
  if (c.operator === 'IS NOT') return `${c.field} IS NOT EMPTY`;
  if (c.operator === 'IN' || c.operator === 'NOT IN') {
    const items = c.values.map((v) => serializeValue(c.field, v)).join(', ');
    return `${c.field} ${c.operator} (${items})`;
  }
  return `${c.field} ${c.operator} ${serializeValue(c.field, c.values[0])}`;
}

/** SimpleQuery → chuỗi JQL hợp lệ ('' nếu không có điều kiện & không sort). */
export function serializeSimpleQuery(q: SimpleQuery): string {
  const clauses = q.conditions.filter(isConditionComplete).map(serializeCondition);
  const where = clauses.join(` ${q.combinator} `);
  const order = q.sort ? `ORDER BY ${q.sort.field} ${q.sort.direction}` : '';
  return [where, order].filter(Boolean).join(' ').trim();
}

/* ------------------------------------------------------------------ */
/* Parse: JQL → SimpleQuery (hoặc null nếu quá phức tạp)               */
/* ------------------------------------------------------------------ */

function valueToStrings(v: JqlValue): string[] {
  switch (v.kind) {
    case 'empty':
      return [];
    case 'list':
      return v.value.flatMap((x) => valueToStrings(x));
    case 'string':
      return [v.value];
    case 'number':
      return [String(v.value)];
    case 'bool':
      return [String(v.value)];
    case 'relativeDate':
      return [`${v.amount}${v.unit}`];
    case 'function':
      return v.name === 'currentUser' ? [CURRENT_USER_TOKEN] : [`${v.name}()`];
    default:
      return [];
  }
}

/** Chuẩn hoá '=' / '!=' trên field phân loại → IN / NOT IN (UI đơn giản hơn). */
function normalizeOperator(field: JqlFieldName, op: string): BuilderOperator {
  if (isCategoricalField(field)) {
    if (op === '=') return 'IN';
    if (op === '!=') return 'NOT IN';
  }
  return op as BuilderOperator;
}

function comparisonToCondition(c: JqlComparison, index: number): SimpleCondition {
  return {
    id: `c${index}`,
    field: c.field,
    operator: normalizeOperator(c.field, c.operator),
    values: valueToStrings(c.value),
  };
}

/**
 * Thử chuyển JQL về SimpleQuery. Trả `null` khi không biểu diễn được ở chế độ đơn giản:
 * có NOT, trộn AND/OR cùng cấp, hoặc nhiều mệnh đề ORDER BY. JQL sai cú pháp → cũng `null`.
 */
export function tryParseToSimpleQuery(jql: string): SimpleQuery | null {
  if (!jql.trim()) return { combinator: 'AND', conditions: [], sort: null };

  let ast;
  try {
    ast = parseJql(jql);
  } catch (e) {
    if (e instanceof JqlParseError) return null;
    throw e;
  }

  // Chỉ hỗ trợ 0 hoặc 1 mệnh đề sắp xếp ở chế độ đơn giản.
  if (ast.orderBy.length > 1) return null;
  const sort: SimpleSort | null = ast.orderBy[0]
    ? { field: (ast.orderBy[0] as JqlOrderBy).field, direction: ast.orderBy[0].direction }
    : null;

  if (!ast.where) return { combinator: 'AND', conditions: [], sort };

  // Làm phẳng cây: mọi nút logical phải cùng một toán tử, không có NOT.
  let combinator: 'AND' | 'OR' | null = null;
  const comparisons: JqlComparison[] = [];
  const walk = (node: JqlNode): boolean => {
    if (node.type === 'comparison') {
      comparisons.push(node);
      return true;
    }
    if (node.type === 'logical') {
      if (combinator === null) combinator = node.op;
      else if (combinator !== node.op) return false;
      return walk(node.left) && walk(node.right);
    }
    return false; // node.type === 'not' → quá phức tạp
  };
  if (!walk(ast.where)) return null;

  return {
    combinator: combinator ?? 'AND',
    conditions: comparisons.map((c, i) => comparisonToCondition(c, i)),
    sort,
  };
}
