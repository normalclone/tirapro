/**
 * Test: `where` (Prisma) có chứa điều kiện TRIAGE_VISIBLE không — dù nằm ở gốc (`OR`) hay trong `AND: [...]`.
 * Dò theo cặp điều kiện nguyên văn nên sẽ FAIL nếu một `OR` khác ghi đè khoá `OR` của nó khi spread.
 */
const TRIAGE_OR_JSON = '[{"triageState":null},{"triageState":"ACCEPTED"}]';

export function hasTriageVisible(where: unknown): boolean {
  return JSON.stringify(where).includes(TRIAGE_OR_JSON);
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
