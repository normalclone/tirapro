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
