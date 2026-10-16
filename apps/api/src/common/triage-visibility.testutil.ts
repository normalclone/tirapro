import { TRIAGE_VISIBLE } from './triage-visibility';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Test: `where` (Prisma) có điều kiện TRIAGE_VISIBLE ĐÚNG CẤU TRÚC ở GỐC không: hoặc `OR` gốc bằng `TRIAGE_VISIBLE.OR`
 * (spread trực tiếp), hoặc `AND` (mảng/đối tượng) có phần tử bằng `TRIAGE_VISIBLE`. Cặp điều kiện nằm trong `NOT`, một
 * nhánh `OR` khác, hay bị một `OR` khác ghi đè khoá `OR` đều KHÔNG tính.
 */
export function hasTriageVisible(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false;
  const w = where as { OR?: unknown; AND?: unknown };
  if (same(w.OR, TRIAGE_VISIBLE.OR)) return true;
  const and = Array.isArray(w.AND) ? w.AND : w.AND ? [w.AND] : [];
  return and.some((c) => same(c, TRIAGE_VISIBLE));
}

/**
 * Ghép một lời gọi tagged template của `$queryRaw` (strings, ...values) thành chuỗi SQL; mảnh `Prisma.sql` lồng nhau
 * được bung ra (giá trị thường thành `?`).
 */
export function flatSql(call: unknown[]): string {
  const strings = call[0] as string[];
  const values = call.slice(1);
  return strings
    .map((s, i) => {
      if (i >= values.length) return s;
      const v = values[i] as { sql?: string } | null;
      return s + (v && typeof v === 'object' && typeof v.sql === 'string' ? v.sql : '?');
    })
    .join('');
}

/** Chuỗi SQL có lọc việc chưa duyệt (dạng `(<alias>."triageState" IS NULL OR <alias>."triageState" = 'ACCEPTED')`). */
export function sqlHasTriageVisible(sql: string): boolean {
  return /"triageState" IS NULL OR [\w".]*"triageState" = 'ACCEPTED'/.test(sql);
}
