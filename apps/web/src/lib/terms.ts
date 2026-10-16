export { STATUS_CATEGORY_LABEL } from '@tirapro/types';

/**
 * Thuật ngữ danh từ dùng chung (một khái niệm = một từ). Xem docs/UX_CONVENTIONS.md §19.
 * Không dùng "issue", "vấn đề", "ticket", "task" làm danh từ chung (`Task` chỉ là TÊN LOẠI).
 */
export const TERM = {
  issue: 'công việc',
  issueShort: 'việc',
  backlog: 'Việc chờ',
  board: 'Bảng việc',
  sprint: 'sprint',
  epic: 'Epic',
} as const;
