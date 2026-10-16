const QUARTER = /^(\d{4})-Q([1-4])$/i;
const DAY_MS = 86_400_000;

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Khoảng ngày (UTC, `YYYY-MM-DD`, gồm cả hai đầu) của kỳ dạng `YYYY-Qn`; kỳ tự do hoặc quý không hợp lệ → `null`.
 */
export function periodRange(period: string): { start: string; end: string } | null {
  const m = QUARTER.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const start = Date.UTC(year, (q - 1) * 3, 1);
  const nextStart = Date.UTC(year, q * 3, 1);
  return { start: iso(start), end: iso(nextStart - DAY_MS) };
}

/**
 * Mốc kỳ vọng (0–100) của một kỳ tại ngày `on` (UTC): tỉ lệ thời gian đã trôi, ngày đầu quý = 0, ngày cuối = 100,
 * kẹp ngoài kỳ. Kỳ tự do → `null` (không có mốc thời gian để so).
 */
export function expectedProgress(period: string, on: Date = new Date()): number | null {
  const range = periodRange(period);
  if (!range) return null;
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  const day = Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());
  const ratio = (day - start) / (end - start);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10;
}
