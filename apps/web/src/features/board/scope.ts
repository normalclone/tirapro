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
