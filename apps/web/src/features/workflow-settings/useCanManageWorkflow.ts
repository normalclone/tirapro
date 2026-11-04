import { useProjectArchived, useCan } from '@/features/projects/permissions';
import { useAuth } from '@/stores/auth';

/**
 * Sửa được quy trình này không? Quản trị chung sửa mọi quy trình; Quản trị dự án sửa quy trình do CHÍNH dự án đó sở hữu
 * (`projectId` = dự án) khi dự án chưa lưu trữ. Quy trình chung của tổ chức hoặc của dự án khác → không. Khớp API
 * (`PermissionsGuard` tính `project:admin` tại dự án sở hữu + `assertCanEdit`).
 */
export function useCanManageWorkflow(
  workflow: { projectId: string | null } | null | undefined,
): boolean {
  const organizationAdmin = useAuth((s) => s.can('organization:admin'));
  const projectId = workflow?.projectId ?? null;
  const can = useCan(projectId);
  const archived = useProjectArchived(projectId);
  return organizationAdmin || (projectId !== null && can('project:admin') && !archived);
}
