import { vnTodayUtc } from '@tirapro/shared';

/** Mục tiêu có kỳ dạng `YYYY-Qn` mới so được với thời gian; kỳ tự do (vd `FY26`) thì không. */
const QUARTER = /^(\d{4})-Q([1-4])$/i;
const DAY_MS = 86_400_000;

/** Mục tiêu bị coi là chậm khi tiến độ thấp hơn phần thời gian đã trôi từ chừng này điểm phần trăm. */
const BEHIND_GAP_POINTS = 15;

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Khoảng ngày (UTC, `YYYY-MM-DD`, gồm cả hai đầu) của kỳ dạng `YYYY-Qn`; kỳ tự do hoặc quý không hợp lệ → `null`.
 */
export function periodRange(period: string): { start: string; end: string } | null {
  const m = QUARTER.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  return {
    start: iso(Date.UTC(year, (q - 1) * 3, 1)),
    end: iso(Date.UTC(year, q * 3, 1) - DAY_MS),
  };
}

/**
 * Phần trăm thời gian đã trôi (0–100, làm tròn số nguyên) của quý trong `period` tại ngày lịch VN của `now`: ngày đầu quý
 * = 0, ngày cuối quý = 100. Kỳ chưa tới → 0, đã qua → 100, không phải dạng `YYYY-Qn` → null (không đánh giá được).
 * MỘT công thức cho thẻ lãnh đạo (OKR chậm) và mốc kỳ vọng của đường tiến độ.
 */
export function expectedProgress(period: string, now: Date): number | null {
  const range = periodRange(period);
  if (!range) return null;
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  const day = vnTodayUtc(now).getTime(); // ngày lịch VN (cùng 'hôm nay' với digest/quá hạn/người quá tải)
  const ratio = (day - start) / (end - start);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** Tiến độ thật chậm hơn thời gian đã trôi từ `BEHIND_GAP_POINTS` điểm phần trăm trở lên. */
export function isBehind(progress: number, expected: number): boolean {
  return expected - progress >= BEHIND_GAP_POINTS;
}
