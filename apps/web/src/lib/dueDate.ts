/**
 * "Quá hạn" — MỘT định nghĩa duy nhất cho web: hạn là NGÀY LỊCH (`YYYY-MM-DDT00:00:00Z` → lấy `YYYY-MM-DD`),
 * so với "hôm nay" theo giờ Việt Nam (khớp phía API). Hạn hôm nay CHƯA quá hạn; hạn hôm qua là quá hạn.
 * Không phụ thuộc múi giờ của máy.
 */
export type DueLike = { dueDate: string | null; status?: { category?: string } | null };
export type DueState = 'overdue' | 'soon' | 'normal';

const VN_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dayNumber = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d) / 86_400_000);
};

/** Số ngày từ HÔM NAY (VN) tới ngày hạn: âm = đã quá hạn bấy nhiêu ngày, 0 = hạn hôm nay. NaN nếu hạn không đọc được. */
export function dueDaysFromToday(dueIso: string, now: Date = new Date()): number {
  const due = dueIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return Number.NaN;
  return dayNumber(due) - dayNumber(VN_DAY.format(now));
}

/** Việc quá hạn: có hạn, chưa Done, ngày hạn < hôm nay (VN). */
export function isOverdue(issue: DueLike, now: Date = new Date()): boolean {
  if (!issue.dueDate || issue.status?.category === 'DONE') return false;
  return dueDaysFromToday(issue.dueDate, now) < 0;
}

/** Phân loại hạn: quá hạn / sắp đến hạn (≤2 ngày) / bình thường. null nếu không có hạn. */
export function dueState(issue: DueLike, now: Date = new Date()): DueState | null {
  if (!issue.dueDate) return null;
  const days = dueDaysFromToday(issue.dueDate, now);
  if (Number.isNaN(days)) return 'normal';
  if (issue.status?.category === 'DONE') return 'normal';
  if (days < 0) return 'overdue';
  if (days <= 2) return 'soon';
  return 'normal';
}
