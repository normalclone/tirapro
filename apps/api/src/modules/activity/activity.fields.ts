import { HistoryField } from '@prisma/client';
import { BusinessRuleException } from '../../common/exceptions/app.exception';

/**
 * `?fields=STATUS,DESCRIPTION` (CSV) hoặc lặp tham số `?fields=A&fields=B` (Nest trả mảng) → danh sách loại thay đổi.
 * Giá trị lạ → 422 "Loại thay đổi không hợp lệ: X". Rỗng/thiếu → `undefined` (không lọc).
 */
export function parseFields(raw?: string | string[]): HistoryField[] | undefined {
  const csv = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const parts = csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  const valid = new Set<string>(Object.values(HistoryField));
  for (const p of parts)
    if (!valid.has(p)) throw new BusinessRuleException(`Loại thay đổi không hợp lệ: ${p}`);
  return [...new Set(parts)] as HistoryField[];
}
