export interface PermissionContext {
  isSystemAdmin?: boolean;
  workspace: readonly string[];
  project?: readonly string[] | null;
}

/** Quyền hiệu lực ở dự án ⊇ quyền workspace (API hợp hai tập vai trò), nên chỉ cần tra cả hai tập. */
export function hasPermission(ctx: PermissionContext, perm: string): boolean {
  return (
    ctx.isSystemAdmin === true || ctx.workspace.includes(perm) || !!ctx.project?.includes(perm)
  );
}

/** Khi dự án đã lưu trữ chỉ còn các quyền ĐỌC; mọi quyền ghi (tạo/kéo/gán/quản lý) tắt. */
const READ_ONLY_PERMISSIONS = new Set(['project:view', 'report:view', 'workspace:view']);
export const allowedWhenArchived = (perm: string): boolean => READ_ONLY_PERMISSIONS.has(perm);

/** Phần của issue dùng để xác định "việc của mình" — cùng quy ước `assertIssueOwner` của API. */
export interface IssueOwnership {
  reporterId?: string | null;
  assigneeId?: string | null;
  /** `IssueDto.createdById` (người tạo) — được tính là chủ sở hữu như ở API. */
  createdById?: string | null;
}

/**
 * Có được sửa/kéo thả issue cụ thể này không: `issue:edit` (mọi issue) HOẶC `issue:edit:own`
 * (Project Reporter) và là reporter/assignee/creator — khớp kiểm sở hữu ở API (S1), tránh nút hiện rồi 403.
 */
export function canEditIssue(
  ctx: PermissionContext,
  issue: IssueOwnership,
  userId: string | null | undefined,
): boolean {
  if (hasPermission(ctx, 'issue:edit')) return true;
  if (!userId || !hasPermission(ctx, 'issue:edit:own')) return false;
  return issue.reporterId === userId || issue.assigneeId === userId || issue.createdById === userId;
}

/**
 * Đọc ô nhập điểm ước lượng: rỗng = xoá điểm (`null`); chấp nhận dấu phẩy thập phân (`2,5`); 0..1000 (khớp schema máy chủ).
 * Quyền SỬA điểm = `canEditIssue` — không có luật riêng (B7).
 */
export function parsePointsInput(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const s = raw.trim().replace(',', '.');
  if (s === '') return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: 'Điểm phải là một con số, ví dụ 3' };
  const n = Number(s);
  return n > 1000 ? { ok: false, error: 'Điểm tối đa là 1000' } : { ok: true, value: n };
}
