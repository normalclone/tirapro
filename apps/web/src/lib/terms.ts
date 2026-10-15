import type { StatusCategory } from '@tirapro/types';

/**
 * Nhãn hiển thị của nhóm trạng thái (category) — MỘT nguồn duy nhất.
 * Dùng thuật ngữ Agile tiếng Anh, khớp tên trạng thái mặc định (To Do / In Progress / Done).
 * "Hoàn thành" chỉ dùng làm động từ (nút "Hoàn thành sprint"). Xem docs/UX_CONVENTIONS.md §19.
 */
export const STATUS_CATEGORY_LABEL: Record<StatusCategory, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
};

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
