import type { CreatedResolvedPoint } from '@tirapro/shared';
import type { ProjectReport } from '@/features/reports/api';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';

export type StatMetric = 'open' | 'overdue' | 'bugs' | 'done14' | 'projects';

/** Nhãn + giải nghĩa số liệu của ô STAT_NUMBER (dùng cả ở khung ô lẫn hộp cấu hình). */
export const STAT_METRIC_META: Record<StatMetric, { label: string; hint: string }> = {
  open: {
    label: 'Việc đang mở',
    hint: `Công việc chưa hoàn thành (${STATUS_CATEGORY_LABEL.TODO} + ${STATUS_CATEGORY_LABEL.IN_PROGRESS}).`,
  },
  overdue: { label: 'Quá hạn', hint: 'Việc chưa xong đã qua hạn.' },
  bugs: { label: 'Bug', hint: 'Công việc loại Bug.' },
  done14: {
    label: `${STATUS_CATEGORY_LABEL.DONE} 14 ngày qua`,
    hint: `Số việc chuyển sang nhóm ${STATUS_CATEGORY_LABEL.DONE} trong 14 ngày gần nhất.`,
  },
  projects: { label: 'Dự án', hint: 'Số dự án đang hoạt động bạn xem được.' },
};

/** Nguồn số liệu chung của một ô: tổng quan workspace hoặc một dự án (đã chuẩn hoá về cùng hình dạng). */
export interface StatSource {
  totals: {
    total: number;
    todo: number;
    inProgress: number;
    done: number;
    overdue: number;
    bug: number;
  };
  projectCount: number;
  /** Số việc xong 14 ngày qua; thiếu = nguồn không cung cấp. */
  resolved14?: number | null;
}

/** Giá trị số của ô; `null` khi nguồn không có số đó (ô hiện "—" thay vì số 0 giả). */
export function statValue(metric: StatMetric, src: StatSource): number | null {
  switch (metric) {
    case 'open':
      return src.totals.todo + src.totals.inProgress;
    case 'overdue':
      return src.totals.overdue;
    case 'bugs':
      return src.totals.bug;
    case 'projects':
      return src.projectCount;
    case 'done14':
      return src.resolved14 ?? null;
  }
}

/** Tổng `resolved` của 14 ngày cuối trong chuỗi theo ngày (`GET /reports/created-resolved`). */
export function resolvedLast14Days(series: CreatedResolvedPoint[]): number {
  return series.slice(-14).reduce((sum, p) => sum + p.resolved, 0);
}

/** Báo cáo dự án không có sẵn số bug → cộng các loại có tên chứa "bug"/"lỗi" (workspace có thể đổi tên loại). */
export function sourceFromProjectReport(
  report: Pick<ProjectReport, 'totals' | 'byType'>,
  resolved14?: number | null,
): StatSource {
  const bug = report.byType
    .filter((t) => /bug|lỗi/i.test(t.name))
    .reduce((sum, t) => sum + t.count, 0);
  const { total, todo, inProgress, done, overdue } = report.totals;
  return { totals: { total, todo, inProgress, done, overdue, bug }, projectCount: 1, resolved14 };
}
