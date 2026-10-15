import { normalizeVi } from '@/lib/text';

/** Tiền tố `value` của mục KHÔNG được lọc theo chữ gõ (kết quả công việc do server trả, "Đi tới công việc", "Gần đây"). */
export const ISSUE_VALUE_PREFIX = 'issue:';

/** Mục "Đi tới công việc" (gõ đúng mã issue): điểm cao để đứng đầu và Enter là điều hướng. */
export const ISSUE_GO_VALUE_PREFIX = `${ISSUE_VALUE_PREFIX}go `;

export { normalizeVi };

/**
 * Bộ lọc cmdk: bỏ dấu cả hai phía, mọi từ gõ phải có trong `value`+`keywords`. Mục kết quả server
 * (`issue:`) luôn hiện nhưng xếp sau lệnh khớp; riêng `issue:go` (mã issue gõ đúng) xếp đầu.
 */
export function commandFilter(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith(ISSUE_GO_VALUE_PREFIX)) return 0.95;
  if (value.startsWith(ISSUE_VALUE_PREFIX)) return 0.001;
  const q = normalizeVi(search);
  if (!q) return 1;
  const hay = normalizeVi([value, ...(keywords ?? [])].join(' '));
  if (!q.split(/\s+/).every((w) => hay.includes(w))) return 0;
  return hay.startsWith(q) ? 1 : hay.includes(` ${q}`) ? 0.9 : hay.includes(q) ? 0.8 : 0.5;
}
