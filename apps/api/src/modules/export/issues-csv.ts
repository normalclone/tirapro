import { z } from 'zod';
import type { CsvColumn } from '@tirapro/shared';
import type { IssueDto } from '@tirapro/types';

/** Một dòng CSV = công việc + hai tên mà `IssueDto` chỉ có dạng id (nạp một lần cho cả lô). */
export type ExportRow = IssueDto & { sprintName: string | null; projectKey: string | null };

/**
 * Id cột xuất. Phần đầu TRÙNG `ResultColumnId` của bảng kết quả JQL (web/features/saved-filters/resultColumns.ts) để
 * "Xuất CSV" ở đó xuất đúng các cột đang xem; `start|sprint|labels|created` chỉ có ở file xuất.
 */
const ISSUE_CSV_COLUMN_IDS = [
  'key',
  'summary',
  'type',
  'status',
  'priority',
  'severity',
  'assignee',
  'reporter',
  'sprint',
  'points',
  'start',
  'due',
  'labels',
  'created',
  'updated',
  'project',
] as const;
export type IssueCsvColumnId = (typeof ISSUE_CSV_COLUMN_IDS)[number];

/** Bộ cột khi không truyền `columns`: đủ cột (không có `project` vì mã đã mang khoá dự án). */
export const DEFAULT_ISSUE_CSV_COLUMNS: readonly IssueCsvColumnId[] = ISSUE_CSV_COLUMN_IDS.filter(
  (id) => id !== 'project',
);

const VN_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Ngày lịch (hạn, bắt đầu) lưu `YYYY-MM-DDT00:00:00Z` → `dd/MM/yyyy` không lệch múi giờ. */
function calendarDmy(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Mốc thời gian → `dd/MM/yyyy HH:mm` giờ Việt Nam (khớp tiếng Việt của giao diện). */
function vnDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(VN_DATE_TIME.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** id → cột. Tiêu đề trùng chữ trên giao diện (Người phụ trách, Mức nghiêm trọng…). */
export const ISSUE_CSV_COLUMN_DEFS: Record<IssueCsvColumnId, CsvColumn<ExportRow>> = {
  key: { header: 'Mã', value: (i) => i.key },
  summary: { header: 'Tiêu đề', value: (i) => i.summary },
  type: { header: 'Loại', value: (i) => i.type?.name },
  status: { header: 'Trạng thái', value: (i) => i.status?.name },
  priority: { header: 'Ưu tiên', value: (i) => i.priority?.name },
  severity: { header: 'Mức nghiêm trọng', value: (i) => i.severity?.name },
  assignee: { header: 'Người phụ trách', value: (i) => i.assignee?.displayName },
  reporter: { header: 'Người báo cáo', value: (i) => i.reporter?.displayName },
  sprint: { header: 'Sprint', value: (i) => i.sprintName },
  points: { header: 'Điểm', value: (i) => i.storyPoints },
  start: { header: 'Bắt đầu', value: (i) => calendarDmy(i.startDate) },
  due: { header: 'Hạn', value: (i) => calendarDmy(i.dueDate) },
  labels: { header: 'Nhãn', value: (i) => (i.labels ?? []).map((l) => l.name).join('; ') },
  created: { header: 'Tạo', value: (i) => vnDateTime(i.createdAt) },
  updated: { header: 'Cập nhật', value: (i) => vnDateTime(i.updatedAt) },
  project: { header: 'Dự án', value: (i) => i.projectKey },
};

const KNOWN = new Set<string>(ISSUE_CSV_COLUMN_IDS);

/**
 * Chuỗi `columns=key,summary,…` → danh sách cột hợp lệ: bỏ id lạ/trùng, luôn có `key` đầu tiên, giữ thứ tự người gọi.
 * Rỗng/không có id nào hợp lệ → bộ mặc định.
 */
export function resolveIssueCsvColumns(raw: string | undefined): IssueCsvColumnId[] {
  const picked: IssueCsvColumnId[] = [];
  for (const part of (raw ?? '').split(',')) {
    const id = part.trim() as IssueCsvColumnId;
    if (KNOWN.has(id) && !picked.includes(id)) picked.push(id);
  }
  if (picked.length === 0) return [...DEFAULT_ISSUE_CSV_COLUMNS];
  return ['key', ...picked.filter((id) => id !== 'key')];
}

export const issuesCsvQuerySchema = z.object({
  projectId: z.string().min(1).max(64).optional(),
  jql: z.string().max(1000).optional(),
  preset: z.enum(['backlog', 'bugs']).optional(),
  sprintId: z.string().min(1).max(64).optional(),
  columns: z.string().max(200).optional(),
  delimiter: z.enum(['comma', 'semicolon']).optional(),
});
export type IssuesCsvQuery = z.infer<typeof issuesCsvQuerySchema>;
