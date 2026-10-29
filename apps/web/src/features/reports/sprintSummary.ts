import type { SprintSummaryReport } from '@tirapro/shared';
import { TERM } from '@/lib/terms';
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

export interface VelocityVerdict {
  text: string;
  tone: 'good' | 'warn' | 'neutral';
}

/** Câu so sánh sprint với velocity TB (`deltaPct` từ máy chủ; null = chưa có sprint đã đóng để so). */
export function velocityVerdict(deltaPct: number | null): VelocityVerdict {
  if (deltaPct === null) return { text: 'Chưa có velocity TB để so', tone: 'neutral' };
  const pct = Math.round(Math.abs(deltaPct));
  if (pct === 0) return { text: 'Bằng velocity TB', tone: 'neutral' };
  return deltaPct > 0
    ? { text: `Cao hơn velocity TB ${pct}%`, tone: 'good' }
    : { text: `Thấp hơn velocity TB ${pct}%`, tone: 'warn' };
}

/** Nơi việc chưa xong được chuyển tới ("Việc chờ", "“Sprint 3”", "“Sprint 3” (mới tạo)"); null = không có dữ liệu. */
export function movedToLabel(movedTo: SprintSummaryReport['movedTo']): string | null {
  if (!movedTo) return null;
  if (movedTo.kind === 'backlog') return TERM.backlog;
  const name = movedTo.sprintName ? `“${movedTo.sprintName}”` : null;
  if (!name) return movedTo.kind === 'new' ? 'một sprint mới' : 'một sprint khác';
  return movedTo.kind === 'new' ? `${name} (mới tạo)` : name;
}

/**
 * Dòng phụ ô "Hoàn thành": "n việc · x%"; phạm vi đổi giữa sprint thì thêm "cam kết ban đầu N điểm" bằng chữ
 * (vạch marker mảnh trên thanh không thấy được trên cảm ứng và khi in).
 */
export function completedSub(
  completed: { count: number; points: number },
  committed: { count: number; points: number },
  initial: { count: number; points: number } | null | undefined,
): string {
  const base = `${completed.count} việc · ${completionPct(completed.points, committed.points)}%`;
  const changed =
    !!initial && (initial.points !== committed.points || initial.count !== committed.count);
  return changed ? `${base} · cam kết ban đầu ${fmtPoints(initial.points)} điểm` : base;
}
