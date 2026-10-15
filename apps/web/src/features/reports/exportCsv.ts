import { toCsv, type CsvColumn } from '@tirapro/shared';
import type { IssueDto } from '@tirapro/types';
import { formatCalendarDmy } from '@/lib/calendarDate';

const COLUMNS: CsvColumn<IssueDto>[] = [
  { header: 'Mã', value: (i) => i.key },
  { header: 'Tóm tắt', value: (i) => i.summary },
  { header: 'Loại', value: (i) => i.type.name },
  { header: 'Trạng thái', value: (i) => i.status.name },
  { header: 'Ưu tiên', value: (i) => i.priority?.name },
  { header: 'Người phụ trách', value: (i) => i.assignee?.displayName },
  { header: 'Điểm', value: (i) => i.storyPoints },
  { header: 'Hạn', value: (i) => formatCalendarDmy(i.dueDate) },
];

/** Việc trong một sprint dạng phẳng (mỗi việc một dòng) — dữ liệu lấy từ danh sách việc của dự án đã có. */
export function sprintIssuesCsv(issues: IssueDto[]): string {
  return toCsv(issues, COLUMNS);
}

/** Tên tệp an toàn: `tirapro-DEMO-sprint-2.csv` (bỏ ký tự không phải chữ/số, giữ tiếng Việt có dấu). */
export function sprintCsvFilename(projectKey: string, sprintName: string): string {
  const slug = sprintName
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `tirapro-${projectKey}-${slug || 'sprint'}.csv`;
}
