import { useCallback } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import type { PermissionKey, ProjectPermissionsDto } from '@tirapro/types';
import { api } from '@/lib/api';
import {
  allowedWhenArchived,
  canEditIssue,
  hasPermission,
  type IssueOwnership,
} from '@/lib/permissions';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/stores/auth';

export function useProjectPermissions(projectId?: string | null) {
  return useQuery({
    queryKey: keys.projects.permissions(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          (await api.get<ProjectPermissionsDto>(`/projects/${projectId}/permissions/me`)).data
      : skipToken,
    staleTime: 60_000, // khớp TTL cache RBAC phía API
  });
}

/** `const can = useCan(project?.id); can('worklog:create')` — quyền hiệu lực trong dự án. */
export function useCan(projectId?: string | null): (perm: PermissionKey) => boolean {
  const isSystemAdmin = useAuth((s) => s.user?.isSystemAdmin === true);
  const workspace = useAuth((s) => s.permissions);
  const project = useProjectPermissions(projectId).data?.permissions;
  return useCallback(
    (perm) => hasPermission({ isSystemAdmin, workspace, project }, perm),
    [isSystemAdmin, workspace, project],
  );
}

/**
 * Như `useCan(project.id)` nhưng dự án đã lưu trữ chỉ giữ quyền đọc (`allowedWhenArchived`) — một điểm duy nhất
 * thay vì rải `&& !archived` khắp trang; API cũng từ chối mọi ghi (422) kể cả system admin.
 */
export function useProjectCan(
  project?: { id: string; archivedAt: string | null } | null,
): (perm: PermissionKey) => boolean {
  const can = useCan(project?.id);
  const archived = !!project?.archivedAt;
  return useCallback(
    (perm) => can(perm) && (!archived || allowedWhenArchived(perm)),
    [can, archived],
  );
}

/**
 * `const canEdit = useCanEditIssue(projectId); canEdit(issue)` — sửa/kéo thả MỘT issue cụ thể
 * (`issue:edit`, hoặc `issue:edit:own` với issue của mình).
 */
export function useCanEditIssue(projectId?: string | null): (issue: IssueOwnership) => boolean {
  const isSystemAdmin = useAuth((s) => s.user?.isSystemAdmin === true);
  const workspace = useAuth((s) => s.permissions);
  const userId = useAuth((s) => s.user?.id);
  const project = useProjectPermissions(projectId).data?.permissions;
  return useCallback(
    (issue) => canEditIssue({ isSystemAdmin, workspace, project }, issue, userId),
    [isSystemAdmin, workspace, project, userId],
  );
}
