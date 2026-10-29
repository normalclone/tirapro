import type { AiSource } from '@tirapro/shared';
import { isModifiedClick } from '@/lib/rowOpen';

/** Số chip nguồn tối đa hiện cùng một gợi ý (máy chủ cũng cắt ở 3). */
const MAX_CHIPS = 3;

export interface SourceChip {
  /** Số thứ tự hiện trong dấu ngoặc vuông, bắt đầu từ 1. */
  n: number;
  key: string;
  summary: string;
  href: string;
  /** Chữ nhìn thấy VÀ tên truy cập: "[1] TP-5 — Tiêu đề" (mã + tiêu đề đều có trong tên). */
  label: string;
}

/**
 * Nguồn của gợi ý → chip đánh số. Chỉ dùng nguồn MÁY CHỦ gửi (đã lọc theo quyền xem); bỏ trùng mã, tối đa 3,
 * tiêu đề gọn về một dòng. `undefined` (máy chủ cũ) = không có nguồn.
 */
export function sourceChips(sources: readonly AiSource[] | undefined): SourceChip[] {
  const seen = new Set<string>();
  const out: SourceChip[] = [];
  for (const s of sources ?? []) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    if (out.length >= MAX_CHIPS) break;
    const n = out.length + 1;
    const summary = s.summary.replace(/\s+/g, ' ').trim();
    out.push({
      n,
      key: s.key,
      summary,
      href: `/issue/${encodeURIComponent(s.key)}`,
      label: summary ? `[${n}] ${s.key} — ${summary}` : `[${n}] ${s.key}`,
    });
  }
  return out;
}

/**
 * Bấm vào chip: bấm thường + màn này có xem nhanh → 'peek'; có phím bổ trợ / chuột giữa / không có xem nhanh → 'native'
 * (link thật tự mở tab mới hoặc điều hướng). Cùng quy ước `IssueKeyLink` (Task 13).
 */
export function sourceClickAction(
  e: Parameters<typeof isModifiedClick>[0],
  hasPeek: boolean,
): 'peek' | 'native' {
  return hasPeek && !isModifiedClick(e) ? 'peek' : 'native';
}
