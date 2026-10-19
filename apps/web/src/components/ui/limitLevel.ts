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
