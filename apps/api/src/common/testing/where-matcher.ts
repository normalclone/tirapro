/**
 * Bộ đánh giá `where` của Prisma trên mảng hàng trong bộ nhớ — CHỈ để test (spec đối chứng, spec riêng tư).
 *
 * Repo không có DB test cho API (spec mock Prisma), nên đây là cách duy nhất để kiểm "where có chọn đúng hàng" mà không
 * chỉ so cấu trúc. Nó mô phỏng ngữ nghĩa SQL một cách NGHIÊM: logic ba giá trị (NULL = "không biết", `NOT NULL` vẫn là
 * NULL, chỉ hàng cho `TRUE` mới được chọn) — nên một `where` quên xử lý NULL (vd `{ col: { not: x } }` trên cột
 * nullable) sẽ bị bắt chứ không lọt qua. `contains` dịch ra LIKE thật (`%`, `_` là ký tự đại diện, `\` thoát) nên
 * thiếu `escapeLike` cũng bị bắt. Hỗ trợ đúng tập toán tử mà code của repo dùng; toán tử lạ → ném lỗi (không đoán).
 */
export type Row = Record<string, unknown>;
type Tri = boolean | null;

const OP_KEYS = new Set([
  'equals',
  'in',
  'notIn',
  'not',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'mode',
]);

const and3 = (xs: Tri[]): Tri =>
  xs.some((x) => x === false) ? false : xs.some((x) => x === null) ? null : true;
const or3 = (xs: Tri[]): Tri =>
  xs.some((x) => x === true) ? true : xs.some((x) => x === null) ? null : false;
const not3 = (x: Tri): Tri => (x === null ? null : !x);

function likeRegExp(pattern: string, insensitive: boolean): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\' && i + 1 < pattern.length) {
      re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (c === '%') re += '[\\s\\S]*';
    else if (c === '_') re += '[\\s\\S]';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, insensitive ? 'i' : '');
}

const key = (v: unknown, insensitive: boolean): unknown =>
  v instanceof Date ? v.getTime() : insensitive && typeof v === 'string' ? v.toLowerCase() : v;

function opGroup(val: unknown, cond: Record<string, unknown>): Tri {
  const insensitive = cond.mode === 'insensitive';
  const results: Tri[] = [];
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'mode') continue;
    if (op === 'not' && arg === null) {
      results.push(val !== null && val !== undefined);
      continue;
    }
    if (op === 'equals' && arg === null) {
      results.push(val === null || val === undefined);
      continue;
    }
    if (val === null || val === undefined) {
      // SQL: so sánh với NULL là NULL; `IN ()` rỗng luôn FALSE, `NOT IN ()` rỗng luôn TRUE.
      if (op === 'in' && (arg as unknown[]).length === 0) results.push(false);
      else if (op === 'notIn' && (arg as unknown[]).length === 0) results.push(true);
      else results.push(null);
      continue;
    }
    const v = key(val, insensitive);
    switch (op) {
      case 'equals':
        results.push(v === key(arg, insensitive));
        break;
      case 'not':
        results.push(v !== key(arg, insensitive));
        break;
      case 'in':
        results.push((arg as unknown[]).some((a) => v === key(a, insensitive)));
        break;
      case 'notIn':
        results.push(!(arg as unknown[]).some((a) => v === key(a, insensitive)));
        break;
      case 'contains':
        results.push(
          typeof val === 'string' && likeRegExp(`%${String(arg)}%`, insensitive).test(val),
        );
        break;
      case 'gt':
        results.push((v as number) > (key(arg, false) as number));
        break;
      case 'gte':
        results.push((v as number) >= (key(arg, false) as number));
        break;
      case 'lt':
        results.push((v as number) < (key(arg, false) as number));
        break;
      case 'lte':
        results.push((v as number) <= (key(arg, false) as number));
        break;
      default:
        throw new Error(`where-matcher: chưa hỗ trợ toán tử ${op}`);
    }
  }
  return and3(results);
}

function fieldMatch(val: unknown, cond: unknown): Tri {
  if (cond === null) return val === null || val === undefined;
  if (typeof cond !== 'object' || cond instanceof Date) {
    return val === null || val === undefined ? null : key(val, false) === key(cond, false);
  }
  const c = cond as Record<string, unknown>;
  if ('some' in c || 'none' in c) {
    const list = Array.isArray(val) ? (val as Row[]) : [];
    const sub = (c.some ?? c.none) as object;
    const exists = list.some((r) => matchRow(r, sub) === true);
    return 'some' in c ? exists : !exists;
  }
  if (Object.keys(c).some((k) => OP_KEYS.has(k))) return opGroup(val, c);
  // Quan hệ một-một (project, status…): thiếu quan hệ → không khớp.
  return val === null || val === undefined ? false : matchRow(val as Row, c);
}

/** `TRUE`/`FALSE`/`NULL` của `where` trên một hàng. */
function matchRow(row: Row, where: object): Tri {
  const parts: Tri[] = [];
  for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (k === 'AND') parts.push(and3(asArray(v).map((w) => matchRow(row, w))));
    else if (k === 'OR') {
      // Prisma thật: `OR: []` ở cấp cao nhất = rỗng, nhưng trong `AND: [...]` bị BỎ QUA (trả mọi hàng) — đo trên Postgres
      // thật. Mô phỏng một nghĩa sẽ che lỗi đó nên từ chối hẳn; dùng `{ id: { in: [] } }` cho "không khớp gì".
      if (Array.isArray(v) && v.length === 0) {
        throw new Error(
          'where-matcher: `OR: []` không nhất quán trong Prisma — dùng { id: { in: [] } }',
        );
      }
      parts.push(or3(asArray(v).map((w) => matchRow(row, w))));
    } else if (k === 'NOT') parts.push(not3(and3(asArray(v).map((w) => matchRow(row, w)))));
    else parts.push(fieldMatch(row[k], v));
  }
  return and3(parts);
}

const asArray = (v: unknown): object[] => (Array.isArray(v) ? (v as object[]) : [v as object]);

/** Hàng được CHỌN: chỉ khi `where` cho TRUE (NULL = không chọn, như SQL). */
export const selects = (row: Row, where: object): boolean => matchRow(row, where) === true;

export const countSelected = (rows: readonly Row[], where: object): number =>
  rows.filter((r) => selects(r, where)).length;
