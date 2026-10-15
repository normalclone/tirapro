import type { BoardType, IssueDto } from '@tirapro/types';

/**
 * Tập việc bảng được phép hiển thị. Scrum = chỉ việc của sprint ĐANG CHẠY (không có sprint chạy ⇒ rỗng);
 * Kanban = mọi việc. Cùng quy tắc với giới hạn WIP (`wipCount`) và máy chủ (`enforceWip`).
 */
export function scopeBoardIssues(
  boardType: BoardType,
  issues: IssueDto[],
  activeSprintId: string | null,
): IssueDto[] {
  if (boardType !== 'SCRUM') return issues;
  if (!activeSprintId) return [];
  return issues.filter((i) => i.sprintId === activeSprintId);
}

/** Câu mô tả trạng thái trống "Scrum chưa có sprint đang chạy": chỉ người có `sprint:manage` mới tự bắt đầu được sprint. */
export function noActiveSprintHint(a: { canManageSprint: boolean; archived: boolean }): string {
  const head = 'Bảng Scrum chỉ hiện việc của sprint đang chạy.';
  if (a.archived) return `${head} Dự án đã lưu trữ nên không thể bắt đầu sprint mới.`;
  return a.canManageSprint
    ? `${head} Lên kế hoạch và bắt đầu một sprint ở Backlog.`
    : `${head} Nhờ quản trị dự án bắt đầu một sprint.`;
}

/**
 * Chế độ swimlane không có hàng nào vì sao? `filtered` = bộ lọc (nhanh/người/JQL của bảng) loại hết; `sprint` = sprint đang chạy
 * chưa có việc; `board` = Kanban chưa có việc. Chỉ nói "khớp bộ lọc" khi thật sự có bộ lọc.
 */
export function swimlaneEmptyKind(a: {
  isScrum: boolean;
  scopedCount: number;
  filtered: boolean;
}): 'filtered' | 'sprint' | 'board' {
  if (a.filtered || a.scopedCount > 0) return 'filtered';
  return a.isScrum ? 'sprint' : 'board';
}
