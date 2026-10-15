import type { IssueDto } from '@tirapro/types';
import { useCanEditIssue, useCanIn } from '@/features/projects/permissions';
import { useAuth } from '@/stores/auth';

/**
 * Hạn hoàn thành: phải sửa được công việc này (issue:edit, hoặc :own với việc của mình) VÀ là người tạo/báo cáo
 * hoặc quản trị (khớp API). Một nơi cho trang chi tiết và panel xem nhanh.
 * KHÔNG áp cho điểm ước lượng: ai sửa được công việc thì sửa được điểm (`canEditIssue`, B7).
 */
export function useCanEditRestricted(issue: IssueDto | undefined): boolean {
  const me = useAuth((s) => s.user);
  const can = useCanIn(issue?.projectId);
  const canEditThis = useCanEditIssue(issue?.projectId)(issue ?? {});
  return (
    !!issue &&
    canEditThis &&
    (issue.reporterId === me?.id ||
      issue.createdById === me?.id ||
      can('workspace:admin') ||
      can('project:admin') ||
      !!me?.isSystemAdmin)
  );
}
