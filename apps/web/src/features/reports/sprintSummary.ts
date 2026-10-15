import { LOCALE } from '@/lib/locale';

const POINTS_FORMAT = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/** Điểm story hiển thị theo locale (số nguyên giữ nguyên, số lẻ tối đa 1 chữ số thập phân). */
export function fmtPoints(n: number): string {
  return POINTS_FORMAT.format(n);
}

/** % hoàn thành làm tròn, kẹp 0..100; cam kết 0 → 0 (không chia cho 0). */
export function completionPct(completed: number, committed: number): number {
  if (!(committed > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((completed / committed) * 100)));
}
