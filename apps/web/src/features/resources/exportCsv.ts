import { formatCalendarDmy, toCsv, type CsvColumn } from '@tirapro/shared';
import type { WorkloadCell, WorkloadReport } from './api';

interface Row {
  person: string;
  cell: WorkloadCell;
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: 'Người', value: (r) => r.person },
  { header: 'Tuần bắt đầu', value: (r) => formatCalendarDmy(r.cell.weekStart) },
  { header: 'Năng lực (giờ)', value: (r) => r.cell.capacityHours },
  { header: 'Được giao (giờ)', value: (r) => r.cell.assignedHours },
  { header: 'Số việc', value: (r) => r.cell.issueCount },
  {
    header: 'Tỷ lệ %',
    value: (r) => (r.cell.ratio == null ? '' : Math.round(r.cell.ratio * 100)),
  },
  { header: 'Quá tải', value: (r) => r.cell.overloaded },
];

/**
 * Mỗi dòng = (người, tuần). Không có cột "Đã ghi" vì chấm công đã gỡ khỏi sản phẩm
 * (`loggedHours` luôn 0).
 */
export function workloadCsv(report: WorkloadReport): string {
  const rows: Row[] = report.rows.flatMap((row) =>
    row.weeks.map((cell) => ({ person: row.user.displayName, cell })),
  );
  return toCsv(rows, COLUMNS);
}
