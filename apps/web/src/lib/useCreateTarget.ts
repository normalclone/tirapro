import { useLocation } from 'react-router-dom';
import { useIssue } from '@/features/issues/api';
import { useProjects } from '@/features/projects/api';
import { useCan, useProjectPermissions } from '@/features/projects/permissions';
import {
  createAccess,
  currentProjectKey,
  issueKeyFromPathname,
  resolveCreateTarget,
  type CreateTarget,
} from './currentProject';

/**
 * Dự án đích của "Tạo việc" + có được tạo ở đó không — dùng chung cho nút Tạo ở khung dự án, phím `c`, Cmd+K và nút nổi
 * để cả bốn lối luôn cùng đích và cùng luật quyền. Ở `/issue/:key` đích là dự án CỦA issue đang xem (kể cả đã lưu trữ → đổi
 * sang dự án hoạt động kèm báo), không phải "dự án xem gần nhất".
 */
export function useCreateTarget(): {
  target: CreateTarget;
  /** undefined = quyền dự án đích chưa tải. */
  canCreate: boolean | undefined;
  access: ReturnType<typeof createAccess>;
} {
  const { pathname } = useLocation();
  const { data: active } = useProjects();
  const issueKey = issueKeyFromPathname(pathname);
  const { data: issue } = useIssue(issueKey);
  const { data: all } = useProjects(true, !!issueKey);
  const issueProjectKey = issue ? all?.find((p) => p.id === issue.projectId)?.key : undefined;

  const target = resolveCreateTarget(issueProjectKey ?? currentProjectKey(active), active);
  const targetProject = target.projectKey
    ? active?.find((p) => p.key.toLowerCase() === target.projectKey!.toLowerCase())
    : undefined;
  const can = useCan(targetProject?.id);
  const permsLoaded = !!useProjectPermissions(targetProject?.id).data;
  const canCreate = targetProject && permsLoaded ? can('issue:create') : undefined;
  return { target, canCreate, access: createAccess(target, canCreate) };
}
