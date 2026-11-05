import type { QaReportDto } from '@tirapro/shared';
import type { OrganizationOverview, OverviewSlice } from '@/features/dashboard/api';
import type { ProjectReport } from '@/features/reports/api';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';

export type PieField = 'status' | 'type' | 'priority' | 'severity' | 'assignee';

const PIE_FIELDS: readonly PieField[] = ['status', 'type', 'priority', 'severity', 'assignee'];

export const PIE_FIELD_LABEL: Record<PieField, string> = {
  status: 'Trạng thái',
  type: 'Loại công việc',
  priority: 'Mức ưu tiên',
  severity: 'Mức nghiêm trọng của bug đang mở',
  assignee: 'Người phụ trách (việc chưa xong)',
};

export const isPieField = (v: unknown): v is PieField => PIE_FIELDS.includes(v as PieField);

/** `severity` lấy từ báo cáo chất lượng (QA), không có trong tổng quan / báo cáo dự án. */
export const isQaField = (f: PieField): boolean => f === 'severity';

/** Việc chưa xong của một người = tổng − đã xong (hàng "Chưa gán" cũng là việc chưa xong). */
export function slicesFromProject(field: PieField, r: ProjectReport): OverviewSlice[] | undefined {
  switch (field) {
    case 'type':
      return r.byType;
    case 'priority':
      return r.byPriority;
    case 'assignee':
      return r.byAssignee.map((a) => ({ name: a.name, color: null, count: a.total - a.done }));
    case 'severity':
      return undefined;
    default:
      return r.byStatus;
  }
}

export function slicesFromOverview(
  field: PieField,
  o: Pick<OrganizationOverview, 'totals' | 'byType' | 'byPriority' | 'byAssignee'>,
): OverviewSlice[] | undefined {
  switch (field) {
    case 'type':
      return o.byType;
    case 'priority':
      return o.byPriority;
    case 'assignee':
      return o.byAssignee;
    case 'severity':
      return undefined;
    default:
      return [
        { name: STATUS_CATEGORY_LABEL.TODO, color: 'var(--status-todo)', count: o.totals.todo },
        {
          name: STATUS_CATEGORY_LABEL.IN_PROGRESS,
          color: 'var(--status-progress)',
          count: o.totals.inProgress,
        },
        { name: STATUS_CATEGORY_LABEL.DONE, color: 'var(--status-done)', count: o.totals.done },
      ];
  }
}

export function slicesFromQa(qa: Pick<QaReportDto, 'openBySeverity'>): OverviewSlice[] {
  return qa.openBySeverity.map((s) => ({ name: s.name, color: s.color, count: s.open }));
}
