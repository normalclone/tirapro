export type LimitLevel = 'none' | 'ok' | 'warn' | 'full' | 'over';

export interface LimitState {
  level: LimitLevel;
  /** Tỉ lệ cho thanh, kẹp 0..1. */
  pct: number;
  /** Phần vượt quá giới hạn (chỉ > 0 khi `level === 'over'`). */
  over: number;
}

/** Làm tròn 2 chữ số thập phân để điểm lẻ (velocity TB) không lộ sai số số thực. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Mức của một hạn mức. Khớp máy chủ: `enforceWip` chặn khi `current + incoming > limit`, nên đúng bằng giới hạn
 * là "đầy" (kéo thêm bị từ chối), còn "vượt" chỉ xảy ra sau "Vẫn chuyển" hoặc khi hạ giới hạn.
 * - `none`: không có giới hạn dùng được (null/undefined/NaN/∞/≤ 0) → không vẽ đồng hồ.
 * - `ok` < 80% · `warn` 80–99% · `full` = 100% · `over` > 100%.
 */
export function limitLevel(used: number, limit: number | null | undefined): LimitState {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return { level: 'none', pct: 0, over: 0 };
  }
  const u = Number.isFinite(used) && used > 0 ? used : 0;
  const pct = Math.min(u / limit, 1);
  if (u > limit) return { level: 'over', pct, over: r2(u - limit) };
  if (u === limit) return { level: 'full', pct, over: 0 };
  // So sánh nguyên (u*100 >= limit*80) tránh sai số của phép chia.
  return { level: u * 100 >= limit * 80 ? 'warn' : 'ok', pct, over: 0 };
}

/**
 * Sức chứa sprint bản nhẹ = velocity TB các sprint đã đóng. Chưa có lịch sử (0/thiếu) → null: ẩn đồng hồ
 * (header đã luôn hiện "N việc · P điểm", không cần một thanh so với 0).
 */
export function sprintCapacityLimit(velocityAvg: number | null | undefined): number | null {
  return velocityAvg != null && Number.isFinite(velocityAvg) && velocityAvg > 0
    ? velocityAvg
    : null;
}

/** Số sprint đã đóng gần nhất dùng tính velocity TB của sức chứa sprint. */
const CAPACITY_SPRINTS = 3;

/**
 * Velocity TB của tối đa `n` sprint đã đóng GẦN NHẤT, tính ở client từ `useVelocity().data.sprints`
 * (API trả cũ → mới). Không đổi `limit` của truy vấn vì khoá cache báo cáo không có `limit`.
 * Trả `count` = số sprint thực sự dùng (0 → chưa có lịch sử).
 */
export function recentVelocity(
  sprints: ReadonlyArray<{ completed: number; committed?: number }> | null | undefined,
  n: number = CAPACITY_SPRINTS,
): { avg: number; count: number } {
  // Sprint đóng nhưng không có ảnh chụp CLOSE được API báo 0/0 → không phải dữ liệu thật, bỏ TRƯỚC khi lấy `n` gần nhất.
  const recent = (sprints ?? [])
    .filter((s) => Number.isFinite(s.completed) && !(s.committed === 0 && s.completed === 0))
    .slice(-n);
  if (recent.length === 0) return { avg: 0, count: 0 };
  return {
    avg: r2(recent.reduce((a, s) => a + s.completed, 0) / recent.length),
    count: recent.length,
  };
}
