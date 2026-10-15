import { toCsv, type CsvColumn } from '@tirapro/shared';
import { formatCalendarDmy as dmy } from '@/lib/calendarDate';
import type { PortfolioRollup, RollupGroup, RollupProject } from './api';

interface Row {
  group: RollupGroup;
  project: RollupProject;
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: 'Chương trình', value: (r) => r.group.name },
  { header: 'Mã dự án', value: (r) => r.project.key },
  { header: 'Tên dự án', value: (r) => r.project.name },
  { header: 'Người phụ trách', value: (r) => r.project.leadName },
  { header: 'Tổng việc', value: (r) => r.project.issueCount },
  { header: 'Xong', value: (r) => r.project.doneCount },
  { header: 'Đang làm', value: (r) => r.project.inProgressCount },
  { header: 'Cần làm', value: (r) => r.project.todoCount },
  { header: 'Quá hạn', value: (r) => r.project.overdueCount },
  { header: 'Tiến độ %', value: (r) => r.project.progressPct },
  { header: 'Bắt đầu', value: (r) => dmy(r.project.startDate) },
  { header: 'Hạn', value: (r) => dmy(r.project.targetDate) },
];

/** Danh mục dự án dạng phẳng: mỗi dự án một dòng, kèm tên chương trình chứa nó. */
export function portfolioCsv(rollup: PortfolioRollup): string {
  const rows: Row[] = rollup.groups.flatMap((group) =>
    group.projects.map((project) => ({ group, project })),
  );
  return toCsv(rows, COLUMNS);
}
