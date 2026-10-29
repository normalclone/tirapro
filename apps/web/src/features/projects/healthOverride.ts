import type { ProjectHealth } from '@tirapro/types';

export const HEALTH_NOTE_MAX = 500;

/**
 * Gửi được chưa: đặt mức thì bắt buộc có ghi chú (≥1 ký tự sau khi cắt khoảng trắng, ≤ 500 — khớp API);
 * `level = null` là "Bỏ ghi đè" nên không cần ghi chú.
 */
export function canSubmit(level: ProjectHealth | null, note: string): boolean {
  if (level === null) return true;
  const n = note.trim().length;
  return n >= 1 && n <= HEALTH_NOTE_MAX;
}
