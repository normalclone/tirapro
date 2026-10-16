/** Mục tiêu có kỳ dạng `YYYY-Qn` mới so được với thời gian; kỳ tự do (vd `FY26`) thì không. */
const QUARTER = /^(\d{4})-Q([1-4])$/;

/** Mục tiêu bị coi là chậm khi tiến độ thấp hơn phần thời gian đã trôi từ chừng này điểm phần trăm. */
export const BEHIND_GAP_POINTS = 15;

/**
 * Phần trăm thời gian đã trôi (0–100, làm tròn) của quý trong `period`, tính theo UTC. Kỳ chưa tới → 0, đã qua → 100,
 * không phải dạng `YYYY-Qn` → null (không đánh giá được).
 */
export function expectedProgress(period: string, now: Date): number | null {
  const m = QUARTER.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  const start = Date.UTC(year, (quarter - 1) * 3, 1);
  const end = Date.UTC(year, quarter * 3, 1);
  const ratio = (now.getTime() - start) / (end - start);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** Tiến độ thật chậm hơn thời gian đã trôi từ `BEHIND_GAP_POINTS` điểm phần trăm trở lên. */
export function isBehind(progress: number, expected: number): boolean {
  return expected - progress >= BEHIND_GAP_POINTS;
}
