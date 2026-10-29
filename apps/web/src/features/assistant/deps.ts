import type { QueryClient } from '@tanstack/react-query';
import type { IssueDto, SprintDto, UserDto } from '@tirapro/types';
import type { ProjectMeta } from '@/features/ai/api';
import { fetchAllProjectIssues } from '@/features/issues/api';
import { userSearchQuery } from '@/features/members/userSearch';
import { projectPermissionsQuery } from '@/features/projects/permissions';
import { fetchJqlPage } from '@/features/saved-filters/api';
import { api, apiErrorCode } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/stores/auth';
import type { AssistantDeps } from './respond';

/** Dữ liệu Trợ lý đọc được giữ trong cache một lúc để hỏi liên tiếp không bắn lại cùng yêu cầu. */
const STALE = 30_000;

/**
 * Nối bộ trả lời với API SẴN CÓ (search/JQL, issues, sprints, meta dự án, thành viên, quyền) qua `queryClient.fetchQuery`
 * trên CÙNG khoá cache với Bảng việc / hộp tạo việc. Quyền theo phiên người dùng (token của họ); không endpoint mới.
 */
export function createAssistantDeps(qc: QueryClient): AssistantDeps {
  return {
    async searchJql(jql) {
      const r = await fetchJqlPage(jql);
      return { items: r.items, hasMore: r.hasMore };
    },
    async getIssue(key) {
      try {
        return await qc.fetchQuery({
          queryKey: keys.issues.byKey(key),
          queryFn: async () => (await api.get<IssueDto>(`/issues/${key}`)).data,
          staleTime: STALE,
        });
      } catch (e) {
        // Không có / không được xem: API trả 404 (hoặc 403) — cho người dùng cùng một câu trả lời.
        const code = apiErrorCode(e);
        if (code === 'NOT_FOUND' || code === 'FORBIDDEN') return null;
        throw e;
      }
    },
    getCommentCount: (issueId) =>
      qc
        .fetchQuery({
          queryKey: keys.issues.comments(issueId),
          queryFn: async () => (await api.get<unknown[]>(`/issues/${issueId}/comments`)).data,
          staleTime: STALE,
        })
        .then((c) => c.length),
    getProjectIssues: (projectId) =>
      qc.fetchQuery({
        queryKey: keys.issues.byProject(projectId),
        queryFn: () => fetchAllProjectIssues(qc, projectId),
        staleTime: STALE,
      }),
    getSprints: (projectId) =>
      qc.fetchQuery({
        queryKey: keys.sprints.byProject(projectId),
        queryFn: async () => (await api.get<SprintDto[]>(`/sprints?projectId=${projectId}`)).data,
        staleTime: STALE,
      }),
    getMeta: (projectKey) =>
      qc.fetchQuery({
        queryKey: keys.ai.projectMeta(projectKey),
        queryFn: async () => (await api.get<ProjectMeta>(`/projects/${projectKey}/meta`)).data,
        staleTime: 5 * 60_000,
      }),
    getUsers: (projectId) =>
      qc.fetchQuery({
        queryKey: keys.users.search(projectId, '', 200, false),
        queryFn: async () =>
          (
            await api.get<UserDto[]>(
              `/users?${userSearchQuery({ projectId, limit: 200, search: '' })}`,
            )
          ).data,
        staleTime: STALE,
      }),
    async canCreate(projectId) {
      const { user, permissions: workspace } = useAuth.getState();
      const isSystemAdmin = user?.isSystemAdmin === true;
      if (hasPermission({ isSystemAdmin, workspace, project: undefined }, 'issue:create'))
        return true;
      try {
        const res = await qc.fetchQuery(projectPermissionsQuery(projectId));
        return hasPermission(
          { isSystemAdmin, workspace, project: res.permissions },
          'issue:create',
        );
      } catch {
        return undefined; // chưa biết → API vẫn kiểm khi tạo
      }
    },
  };
}
