/**
 * Đọc/ghi khoảng thời gian kiểu Jira ("2h 30m", "1d", "1.5h") ↔ số giây.
 * Một ngày = `hoursPerDay` giờ (mặc định 8), một tuần = `daysPerWeek` ngày (mặc định 5).
 */
export interface DurationOptions {
  hoursPerDay?: number;
  daysPerWeek?: number;
}

/** Chặn giá trị phi lý (và tràn cột Int của DB): tối đa 10 năm. */
export const MAX_DURATION_SEC = 10 * 365 * 86_400;

const TOKEN = /(\d+(?:\.\d+)?)\s*([wdhms])/gy;

/**
 * Trả số giây, hoặc `null` nếu chuỗi không hợp lệ (rỗng, thiếu đơn vị, có ký tự lạ).
 * Cho phép nhiều thành phần: "1d 2h 15m", "2h30m". Số có phần thập phân: "1.5h" = 5400.
 */
export function parseDuration(input: string, opts: DurationOptions = {}): number | null {
  const hoursPerDay = opts.hoursPerDay ?? 8;
  const daysPerWeek = opts.daysPerWeek ?? 5;
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const unitSec: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: hoursPerDay * 3600,
    w: daysPerWeek * hoursPerDay * 3600,
  };
  let total = 0;
  let pos = 0;
  TOKEN.lastIndex = 0;
  while (pos < text.length) {
    // bỏ khoảng trắng giữa các thành phần
    while (text[pos] === ' ') pos++;
    if (pos >= text.length) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) return null;
    total += Number(m[1]) * (unitSec[m[2] as string] as number);
    pos = TOKEN.lastIndex;
  }
  return Number.isFinite(total) && total <= MAX_DURATION_SEC ? Math.round(total) : null;
}

/** Số giây → "2h 30m" (làm tròn LÊN phút; 0 → "0m"). Không đổi sang ngày để khỏi lệ thuộc cấu hình. */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const minutes = Math.ceil(sec / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m || !h) parts.push(`${m}m`);
  return parts.join(' ');
}
