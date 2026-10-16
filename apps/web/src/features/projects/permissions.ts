import { useCallback } from 'react';
import { queryOptions, skipToken, useQueries, useQuery } from '@tanstack/react-query';
import type { PermissionKey, ProjectPermissionsDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { useProjects } from './api';
import {
  allowedWhenArchived,
  canEditIssue,
  hasPermission,
  type IssueOwnership,
} from '@/lib/permissions';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/stores/auth';

function projectPermissionsQuery(projectId?: string | null) {
  return queryOptions({
    queryKey: keys.projects.permissions(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          (await api.get<ProjectPermissionsDto>(`/projects/${projectId}/permissions/me`)).data
      : skipToken,
    staleTime: 60_000, // khớp TTL cache RBAC phía API
    // Lỗi mạng: thử lại tối đa 1 lần (mặc định 3 lần giãn dần giữ skeleton hàng chục giây ở nơi chờ quyền).
    retry: 1,
  });
}

export function useProjectPermissions(projectId?: string | null) {
  return useQuery(projectPermissionsQuery(projectId));
}

/**
 * Có `perm` ở TỪNG dự án trong danh sách không (dùng chung cache `useProjectPermissions`): true/false, undefined = quyền dự án
 * đó đang tải. Dùng để chọn dự án mặc định "dự án đầu tiên tôi CÓ quyền" mà không gọi API nghiệp vụ ở dự án không có quyền.
 */
export function useProjectsCan(
  projectIds: readonly string[],
  perm: PermissionKey,
): (projectId: string) => boolean | undefined {
  const isSystemAdmin = useAuth((s) => s.user?.isSystemAdmin === true);
  const workspace = useAuth((s) => s.permissions);
  const results = useQueries({ queries: projectIds.map((id) => projectPermissionsQuery(id)) });
  const byId = new Map<string, boolean | undefined>();
  projectIds.forEach((id, i) => {
    const project = results[i]?.data?.permissions;
    // Có từ cấp workspace/system admin → khỏi chờ quyền dự án; chưa có dữ liệu mà cũng chưa lỗi → chưa biết.
    const known = hasPermission({ isSystemAdmin, workspace, project }, perm);
    byId.set(id, known || project || results[i]?.isError ? known : undefined);
  });
  return (id) => byId.get(id);
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
 * Dự án `projectId` đã lưu trữ chưa? Tra từ danh sách dự án KÈM đã lưu trữ (một cache dùng chung, invalidate cùng `projects.all`).
 * Danh sách chưa tải → coi là chưa lưu trữ (API vẫn chặn ghi bằng 422).
 */
export function useProjectArchived(projectId?: string | null): boolean {
  const { data } = useProjects(true, !!projectId);
  return !!projectId && !!data?.find((p) => p.id === projectId)?.archivedAt;
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
 * Như `useProjectCan` nhưng chỉ có `projectId` (trang issue, panel…): tự tra dự án đã lưu trữ chưa (`useProjectArchived`).
 * Dùng cho MỌI chỗ kiểm quyền GHI theo dự án của một issue; `useCan` thô chỉ dành cho việc quản trị dự án (vd khôi phục dự án lưu trữ).
 */
export function useCanIn(projectId?: string | null): (perm: PermissionKey) => boolean {
  const can = useCan(projectId);
  const archived = useProjectArchived(projectId);
  return useCallback(
    (perm) => can(perm) && (!archived || allowedWhenArchived(perm)),
    [can, archived],
  );
}

/**
 * `const canEdit = useCanEditIssue(projectId); canEdit(issue)` — sửa/kéo thả MỘT issue cụ thể
 * (`issue:edit`, hoặc `issue:edit:own` với issue của mình). Dự án đã lưu trữ → luôn false (chỉ đọc).
 */
export function useCanEditIssue(projectId?: string | null): (issue: IssueOwnership) => boolean {
  const isSystemAdmin = useAuth((s) => s.user?.isSystemAdmin === true);
  const workspace = useAuth((s) => s.permissions);
  const userId = useAuth((s) => s.user?.id);
  const project = useProjectPermissions(projectId).data?.permissions;
  const archived = useProjectArchived(projectId);
  return useCallback(
    (issue) => !archived && canEditIssue({ isSystemAdmin, workspace, project }, issue, userId),
    [isSystemAdmin, workspace, project, userId, archived],
  );
}

/**
 * `const canSchedule = useCanEditSchedule(projectId); canSchedule(issue)` — đổi lịch của MỘT công việc
 * (Ngày bắt đầu, Hạn; điểm ước lượng KHÔNG qua đây — B7): phải sửa được việc đó (`useCanEditIssue`) VÀ là người tạo/báo cáo hoặc quản trị
 * (project/workspace/system admin) — khớp `assertCanEditRestrictedFields` ở API. Một luật cho trang chi tiết, panel xem
 * nhanh và Gantt (L15) để không có chỗ cho kéo được mà server từ chối một nửa.
 */
export function useCanEditSchedule(projectId?: string | null): (issue: IssueOwnership) => boolean {
  const canEdit = useCanEditIssue(projectId);
  const can = useCanIn(projectId);
  const me = useAuth((s) => s.user);
  return useCallback(
    (issue) =>
      canEdit(issue) &&
      (me?.isSystemAdmin === true ||
        (!!me?.id &&
          (issue.reporterId === me.id ||
            issue.createdById === me.id ||
            can('workspace:admin') ||
            can('project:admin')))),
    [canEdit, can, me],
  );
}
