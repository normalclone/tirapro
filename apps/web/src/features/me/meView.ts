import type { MeIssueItemDto, MeOverviewDto } from '@tirapro/types';

/** Chip lọc nhanh theo dự án: mã dự án + số việc, nhiều việc nhất trước (đồng hạng theo mã). */
export function projectChips(items: readonly MeIssueItemDto[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.projectKey, (counts.get(i.projectKey) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
}

/** Lọc theo mã dự án; `null` = tất cả. Giữ nguyên thứ tự máy chủ đã sắp (hạn rồi ưu tiên). */
export function filterByProject(
  items: readonly MeIssueItemDto[],
  projectKey: string | null,
): MeIssueItemDto[] {
  return projectKey ? items.filter((i) => i.projectKey === projectKey) : [...items];
}

export type BugTab = 'awaitingRetest' | 'reopened' | 'assignedToMe';

/** Tab bug mở sẵn: tab đầu tiên có việc (ưu tiên việc cần tôi làm ngay), không có thì tab đầu. */
export function defaultBugTab(bugs: MeOverviewDto['bugs']): BugTab {
  const order: BugTab[] = ['awaitingRetest', 'reopened', 'assignedToMe'];
  return order.find((t) => bugs[t].length > 0) ?? 'awaitingRetest';
}

/** `YYYY-MM-DD` (Thứ Hai VN) → `dd/MM`. */
export function weekLabel(weekStart: string): string {
  const [, m, d] = weekStart.split('-');
  return `${d}/${m}`;
}

const MAX_SERIES = 5;
export const OTHER_SERIES = 'Khác';
const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
];

export interface ChartModel {
  rows: ({ week: string; weekStart: string; total: number } & Record<string, number | string>)[];
  series: { key: string; color: string }[];
  totalPoints: number;
}

/**
 * Dữ liệu cột chồng: mỗi tuần một cột, mỗi dự án một màu (`--series-1..5`). Quá 5 dự án → 4 dự án nhiều điểm nhất
 * (cả 8 tuần) + "Khác" gộp phần còn lại, để màu vẫn phân biệt được.
 */
export function buildChart(weeks: MeOverviewDto['weeklyDonePoints']): ChartModel {
  const totals = new Map<string, number>();
  for (const w of weeks)
    for (const p of w.byProject)
      totals.set(p.projectKey, (totals.get(p.projectKey) ?? 0) + p.points);
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k]) => k);
  const merge = ranked.length > MAX_SERIES;
  const named = merge ? ranked.slice(0, MAX_SERIES - 1) : ranked;
  const series = named.map((key, i) => ({ key, color: SERIES_COLORS[i]! }));
  if (merge) series.push({ key: OTHER_SERIES, color: 'var(--faint)' });
  const rows = weeks.map((w) => {
    const row: ChartModel['rows'][number] = {
      week: weekLabel(w.weekStart),
      weekStart: w.weekStart,
      total: 0,
    };
    for (const s of series) row[s.key] = 0;
    for (const p of w.byProject) {
      const k = named.includes(p.projectKey) ? p.projectKey : OTHER_SERIES;
      row[k] = Math.round(((row[k] as number) + p.points) * 100) / 100;
      row.total = Math.round((row.total + p.points) * 100) / 100;
    }
    return row;
  });
  const totalPoints = Math.round([...totals.values()].reduce((s, v) => s + v, 0) * 100) / 100;
  return { rows, series, totalPoints };
}

/** Mô tả chữ của biểu đồ cho trình đọc màn hình. */
export function chartSummary(model: ChartModel): string {
  const parts = model.rows
    .filter((r) => r.total > 0)
    .map(
      (r) =>
        `tuần ${r.week}: ${r.total} điểm (${model.series
          .filter((s) => (r[s.key] as number) > 0)
          .map((s) => `${s.key} ${r[s.key]}`)
          .join(', ')})`,
    );
  return parts.length
    ? `Điểm đã xong theo tuần, ${parts.join('; ')}`
    : 'Điểm đã xong theo tuần: chưa có';
}
