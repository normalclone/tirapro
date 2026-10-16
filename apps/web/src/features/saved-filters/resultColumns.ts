import type { IssueDto } from '@tirapro/types';
import { fmtDate } from '@/lib/dateFormat';

/**
 * Cột của bảng kết quả JQL/bộ lọc. MỘT nguồn `cellText` cho cả ô bảng lẫn xuất CSV (L2) để hai nơi cùng chữ.
 * Không có cột Sprint: `IssueDto` chỉ có `sprintId` (không có tên), tránh gọi thêm API.
 */
export type ResultColumnId =
  | 'key'
  | 'summary'
  | 'type'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'reporter'
  | 'points'
  | 'due'
  | 'updated'
  | 'project'
  | 'severity';

export interface ResultColumnDef {
  id: ResultColumnId;
  /** Tiêu đề cột (cũng là tiêu đề cột CSV). */
  label: string;
  /** `key`/`summary` luôn bật, không tắt được. */
  locked?: boolean;
}

/** Thứ tự chuẩn của cột (bảng hiển thị theo thứ tự này, không theo thứ tự bấm chọn). */
export const RESULT_COLUMNS: readonly ResultColumnDef[] = [
  { id: 'key', label: 'Mã', locked: true },
  { id: 'summary', label: 'Tiêu đề', locked: true },
  { id: 'type', label: 'Loại' },
  { id: 'status', label: 'Trạng thái' },
  { id: 'priority', label: 'Ưu tiên' },
  { id: 'assignee', label: 'Người được giao' },
  { id: 'reporter', label: 'Người báo' },
  { id: 'points', label: 'Điểm' },
  { id: 'due', label: 'Hạn' },
  { id: 'updated', label: 'Cập nhật' },
  { id: 'project', label: 'Dự án' },
  { id: 'severity', label: 'Mức nghiêm trọng' },
];

export const DEFAULT_RESULT_COLUMNS: ResultColumnId[] = [
  'key',
  'summary',
  'status',
  'priority',
  'assignee',
  'points',
  'due',
];

const KNOWN = new Set<string>(RESULT_COLUMNS.map((c) => c.id));

/**
 * Cột đã lưu (chuỗi JSON) → danh sách hợp lệ: bỏ id lạ/trùng, luôn có `key` + `summary` ở đầu, xếp theo thứ tự chuẩn.
 * Rỗng/hỏng/không có id nào hợp lệ → mặc định.
 */
export function readColumns(raw: string | null): ResultColumnId[] {
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    return [...DEFAULT_RESULT_COLUMNS];
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_RESULT_COLUMNS];
  const picked = new Set(parsed.filter((x): x is string => typeof x === 'string' && KNOWN.has(x)));
  if (picked.size === 0) return [...DEFAULT_RESULT_COLUMNS];
  return RESULT_COLUMNS.filter((c) => c.locked || picked.has(c.id)).map((c) => c.id);
}

/** Chuỗi thuần của một ô (hiển thị và CSV). Thiếu giá trị → '' (không bao giờ "undefined"/"null"). */
export function cellText(
  issue: IssueDto,
  col: ResultColumnId,
  ctx: { projectKeyById: Map<string, string> },
): string {
  switch (col) {
    case 'key':
      return issue.key ?? '';
    case 'summary':
      return issue.summary ?? '';
    case 'type':
      return issue.type?.name ?? '';
    case 'status':
      return issue.status?.name ?? '';
    case 'priority':
      return issue.priority?.name ?? '';
    case 'assignee':
      return issue.assignee?.displayName ?? '';
    case 'reporter':
      return issue.reporter?.displayName ?? '';
    case 'points':
      return issue.storyPoints === null || issue.storyPoints === undefined
        ? ''
        : String(issue.storyPoints);
    case 'due':
      return issue.dueDate ? fmtDate(issue.dueDate) : '';
    case 'updated':
      return issue.updatedAt ? fmtDate(issue.updatedAt) : '';
    case 'project':
      return ctx.projectKeyById.get(issue.projectId) ?? '';
    case 'severity':
      return issue.severity?.name ?? '';
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const columnsStorageKey = (userId: string) => `tirapro:jqlColumns:v1:${userId}`;

/** Đọc cột đã lưu của người dùng; storage bị chặn/hỏng → mặc định. */
export function loadColumns(userId: string, storage: StorageLike = localStorage): ResultColumnId[] {
  try {
    return readColumns(storage.getItem(columnsStorageKey(userId)));
  } catch {
    return [...DEFAULT_RESULT_COLUMNS];
  }
}

export function saveColumns(
  userId: string,
  columns: ResultColumnId[],
  storage: StorageLike = localStorage,
): void {
  try {
    storage.setItem(columnsStorageKey(userId), JSON.stringify(columns));
  } catch {
    /* storage bị chặn: bỏ qua, lựa chọn chỉ có hiệu lực trong phiên */
  }
}
