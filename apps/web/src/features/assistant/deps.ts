import type { QueryClient } from '@tanstack/react-query';
import type {
  IssueDto,
  MemberDto,
  PermissionKey,
  RoleDto,
  SprintDto,
  TeamDto,
  UserDto,
} from '@tirapro/types';
import type { ProjectMeta } from '@/features/ai/api';
import { fetchAllProjectIssues } from '@/features/issues/api';
import { userSearchQuery } from '@/features/members/userSearch';
import { projectPermissionsQuery } from '@/features/projects/permissions';
import { fetchJqlPage } from '@/features/saved-filters/api';
import { api, apiErrorCode } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/stores/auth';
import type { ProgramDto } from '@/features/projects/groups/programsApi';
import type { AssistantDeps } from './respond';

/** Dữ liệu Trợ lý đọc được giữ trong cache một lúc để hỏi liên tiếp không bắn lại cùng yêu cầu. */
const STALE = 30_000;

/** Người gõ có `permission` ở dự án không: quyền cấp tổ chức/hệ thống, rồi quyền của dự án. undefined = chưa biết. */
async function canIn(
  qc: QueryClient,
  projectId: string,
  permission: PermissionKey,
): Promise<boolean | undefined> {
  const { user, permissions: organization } = useAuth.getState();
  const isSystemAdmin = user?.isSystemAdmin === true;
  if (hasPermission({ isSystemAdmin, organization, project: undefined }, permission)) return true;
  try {
    const res = await qc.fetchQuery(projectPermissionsQuery(projectId));
    return hasPermission({ isSystemAdmin, organization, project: res.permissions }, permission);
  } catch {
    return undefined; // chưa biết → máy chủ vẫn kiểm khi thực hiện
  }
}

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
    getPeople: () =>
      qc.fetchQuery({
        queryKey: keys.users.search('', '', 200, false),
        queryFn: async () =>
          (await api.get<UserDto[]>(`/users?${userSearchQuery({ limit: 200, search: '' })}`)).data,
        staleTime: STALE,
      }),
    async searchPeople(query) {
      return (await api.get<UserDto[]>(`/users?${userSearchQuery({ limit: 20, search: query })}`))
        .data;
    },
    getMyGroups: () =>
      qc.fetchQuery({
        queryKey: keys.programs.all,
        queryFn: async () => (await api.get<ProgramDto[]>('/programs')).data,
        staleTime: STALE,
      }),
    getTeams: () =>
      qc.fetchQuery({
        queryKey: keys.teams.all,
        queryFn: async () => (await api.get<TeamDto[]>('/teams')).data,
        staleTime: STALE,
      }),
    getProjectRoles: () =>
      qc.fetchQuery({
        queryKey: keys.roles.byScope('PROJECT'),
        queryFn: async () => (await api.get<RoleDto[]>('/roles?scope=PROJECT')).data,
        staleTime: 5 * 60_000,
      }),
    canCreate: (projectId) => canIn(qc, projectId, 'issue:create'),
    can: (projectId, permission) => canIn(qc, projectId, permission),
    getProjectMembers: async (projectId) =>
      (
        await qc.fetchQuery({
          queryKey: keys.members.project(projectId),
          queryFn: async () => (await api.get<MemberDto[]>(`/projects/${projectId}/members`)).data,
          staleTime: 0, // thẻ xem trước phải thấy trạng thái MỚI NHẤT (máy chủ còn so lại lúc thực hiện)
        })
      ).map((m) => ({
        userId: m.user.id,
        roleIds: m.roles.map((r) => r.id),
        roleNames: m.roles.map((r) => r.name),
        isOverride: m.isOverride === true,
      })),
    async getOpenLoad(personIds) {
      const entries = await Promise.all(
        personIds.map(async (id) => {
          try {
            const r = await fetchJqlPage(
              `assignee = "${id.replace(/["\\]/g, '')}" AND statusCategory != DONE`,
            );
            return [id, r.items.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)] as const;
          } catch {
            return [id, 0] as const; // không đọc được → coi như 0 (chỉ ảnh hưởng cách chia theo điểm)
          }
        }),
      );
      return Object.fromEntries(entries);
    },
  };
}
