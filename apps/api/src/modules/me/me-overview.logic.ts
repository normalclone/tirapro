import { foldForMatch, vnTodayUtc } from '@tirapro/shared';
import { addDays, isoDay, startOfWeek } from '../resources/date.util';

const HOUR_MS = 3_600_000;
/** Múi giờ Việt Nam cố định UTC+7 (không có giờ mùa hè). */
const VN_OFFSET_MS = 7 * HOUR_MS;
export const OVERVIEW_WEEKS = 8;

export interface StatusLite {
  id: string;
  name: string;
  category: 'TODO' | 'IN_PROGRESS' | 'DONE';
}

/**
 * Phân loại trạng thái cho khối "Bug liên quan đến tôi" (trước khi có Bug Workflow):
 * - chờ test lại: tên `Ready for Retest`, HOẶC nhóm IN_PROGRESS có tên chứa "test";
 * - mở lại: tên `Reopened` / "Mở lại".
 * So tên không phân biệt hoa/thường/dấu (`foldForMatch`).
 */
export function classifyStatuses(statuses: readonly StatusLite[]): {
  awaitingRetest: string[];
  reopened: string[];
} {
  const awaitingRetest: string[] = [];
  const reopened: string[] = [];
  for (const s of statuses) {
    const n = foldForMatch(s.name);
    if (n === 'ready for retest' || (s.category === 'IN_PROGRESS' && n.includes('test')))
      awaitingRetest.push(s.id);
    if (n === 'reopened' || n === 'mo lai') reopened.push(s.id);
  }
  return { awaitingRetest, reopened };
}

interface SortKey {
  id: string;
  dueDate: Date | null;
  priorityRank: number | null;
}

/** Hạn tăng dần (không hạn cuối) → ưu tiên giảm dần (không ưu tiên cuối) → id. */
export function sortMyIssueKeys<T extends SortKey>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.dueDate?.getTime() !== b.dueDate?.getTime()) {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    }
    if (a.priorityRank !== b.priorityRank) {
      if (a.priorityRank === null) return 1;
      if (b.priorityRank === null) return -1;
      return b.priorityRank - a.priorityRank;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface VnWeek {
  /** `YYYY-MM-DD` của Thứ Hai (ngày lịch VN). */
  label: string;
  /** Mốc tức thời 00:00 giờ VN của Thứ Hai (tính cả đầu). */
  from: Date;
  /** Mốc tức thời 00:00 giờ VN của Thứ Hai kế tiếp (không tính). */
  to: Date;
}

/** 8 tuần VN kết thúc ở tuần chứa `now` (cũ → mới). Tuần bắt đầu Thứ Hai 00:00 giờ VN. */
export function vnWeekStarts(now: Date): VnWeek[] {
  const thisMonday = startOfWeek(vnTodayUtc(now)); // nửa đêm UTC mang giá trị NGÀY LỊCH VN
  return Array.from({ length: OVERVIEW_WEEKS }, (_, i) => {
    const monday = addDays(thisMonday, (i - (OVERVIEW_WEEKS - 1)) * 7);
    const from = new Date(monday.getTime() - VN_OFFSET_MS);
    return { label: isoDay(monday), from, to: new Date(from.getTime() + 7 * 24 * HOUR_MS) };
  });
}

/** Cộng điểm đã xong vào từng tuần VN theo dự án (điểm ngoài 8 tuần bị bỏ). Dự án trong tuần xếp điểm giảm dần, rồi khoá. */
export function bucketDonePoints(
  weeks: readonly VnWeek[],
  rows: readonly { resolvedAt: Date; projectKey: string; points: number }[],
): { weekStart: string; byProject: { projectKey: string; points: number }[] }[] {
  const sums = weeks.map(() => new Map<string, number>());
  for (const r of rows) {
    const t = r.resolvedAt.getTime();
    const idx = weeks.findIndex((w) => t >= w.from.getTime() && t < w.to.getTime());
    if (idx < 0) continue;
    sums[idx]!.set(r.projectKey, (sums[idx]!.get(r.projectKey) ?? 0) + r.points);
  }
  return weeks.map((w, i) => ({
    weekStart: w.label,
    byProject: [...sums[i]!.entries()]
      .map(([projectKey, points]) => ({ projectKey, points: Math.round(points * 100) / 100 }))
      .sort((a, b) => b.points - a.points || (a.projectKey < b.projectKey ? -1 : 1)),
  }));
}
