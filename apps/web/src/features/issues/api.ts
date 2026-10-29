import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { CommentDto, IssueDto, IssueTransitionResultDto, ListResponse } from '@tirapro/types';
import { extractMentionIds } from '@tirapro/shared';
import { api, apiErrorCode } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import {
  invalidateIssue,
  optimisticPatchIssue,
  rollbackIssue,
  scalarIssuePatch,
  writeIssue,
} from '@/lib/optimistic';
import { statusPatch, type TransitionVars } from '@/features/board/api';
import { recordIssueChange } from './menu/issueOverlay';

export interface DevLinkItem {
  id: string;
  type: string;
  state: string | null;
  externalId: string;
  title: string | null;
  url: string;
  branch: string | null;
  authorName: string | null;
  mergedAt: string | null;
  repository?: { name: string; url: string } | null;
  createdAt: string;
}

/** Liên kết code (commit/PR/branch) của issue — cho dev panel. */
export function useDevLinks(issueId: string | undefined) {
  return useQuery({
    queryKey: keys.issues.devLinks(issueId ?? ''),
    queryFn: issueId
      ? async () => (await api.get<DevLinkItem[]>(`/issues/${issueId}/dev-links`)).data
      : skipToken,
  });
}

/** Mỗi trang xin tối đa 100 — bằng mức máy chủ cho phép (`issues.controller` kẹp limit ở 100). */
const PAGE_LIMIT = 100;
/** Trần số việc gom về một lần; vượt thì cắt và báo người dùng dùng bộ lọc. */
export const ISSUE_LIST_HARD_CAP = 2000;

export interface IssueListMeta {
  /** Dự án còn việc chưa nạp (đã chạm trần). */
  truncated: boolean;
  /** Số việc đã nạp được. */
  loaded: number;
}

/**
 * Danh sách issue của MỘT project — cache duy nhất `keys.issues.byProject(pid)`,
 * Board / Backlog / Gantt / Tree / chi tiết issue đều đọc chung và `useProjectIssues` vá vào đây.
 * Đi theo cursor (`pageInfo.endCursor`) đến hết hoặc đến HARD_CAP. Dữ liệu cache vẫn là `IssueDto[]`;
 * cờ cắt ghi vào query phụ `byProjectMeta` (đọc bằng `useIssueListTruncated`).
 */
export async function fetchAllProjectIssues(
  qc: QueryClient,
  projectId: string,
): Promise<IssueDto[]> {
  const all: IssueDto[] = [];
  let cursor: string | null = null;
  let truncated = false;
  for (;;) {
    const qs = new URLSearchParams({ projectId, limit: String(PAGE_LIMIT) });
    if (cursor) qs.set('cursor', cursor);
    const res: ListResponse<IssueDto> = (
      await api.get<ListResponse<IssueDto>>(`/issues?${qs.toString()}`)
    ).data;
    all.push(...res.data);
    const info = res.pageInfo;
    const next = 'hasNextPage' in info && info.hasNextPage ? info.endCursor : null;
    if (!next || res.data.length === 0) break;
    if (all.length >= ISSUE_LIST_HARD_CAP) {
      truncated = true;
      break;
    }
    cursor = next;
  }
  const meta: IssueListMeta = { truncated, loaded: all.length };
  qc.setQueryData<IssueListMeta>(keys.issues.byProjectMeta(projectId), meta);
  return all;
}

export function useProjectIssues(projectId: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.issues.byProject(projectId ?? ''),
    queryFn: projectId ? () => fetchAllProjectIssues(qc, projectId) : skipToken,
  });
}

/** Danh sách việc của dự án có bị cắt ở HARD_CAP không (đọc từ query phụ do `useProjectIssues` ghi). */
export function useIssueListTruncated(projectId: string | undefined): IssueListMeta | null {
  const { data } = useQuery<IssueListMeta>({
    queryKey: keys.issues.byProjectMeta(projectId ?? ''),
    queryFn: skipToken,
    enabled: !!projectId,
  });
  return data?.truncated ? data : null;
}

/**
 * Đọc MỘT việc (vd việc cha cho breadcrumb) từ cache dự án mà KHÔNG kích hoạt tải cả danh sách (`enabled: false`).
 * Không dùng `skipToken` ở đây: nó sẽ ghi đè `queryFn` của query dùng chung và làm invalidate bỏ qua query này.
 * `select` cắt đúng phần cần nên chỉ vẽ lại khi phần đó đổi, không phải mỗi lần realtime vá việc khác.
 */
export function useCachedProjectIssue<T>(
  projectId: string | undefined,
  pick: (list: IssueDto[]) => T,
) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.issues.byProject(projectId ?? ''),
    queryFn: () => fetchAllProjectIssues(qc, projectId ?? ''),
    enabled: false,
    select: pick,
  });
}

export function useIssue(key: string | null) {
  return useQuery({
    queryKey: keys.issues.byKey(key ?? ''),
    queryFn: key ? async () => (await api.get<IssueDto>(`/issues/${key}`)).data : skipToken,
    // 404 là kết luận cuối (mã không tồn tại/không có quyền) — thử lại chỉ làm trang báo lỗi chậm thêm 1-2s.
    retry: (n, err) => apiErrorCode(err) !== 'NOT_FOUND' && n < 1,
  });
}

export function useComments(issueId: string | undefined) {
  return useQuery({
    queryKey: keys.issues.comments(issueId ?? ''),
    queryFn: issueId
      ? async () => (await api.get<CommentDto[]>(`/issues/${issueId}/comments`)).data
      : skipToken,
  });
}

export function useAddComment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post<CommentDto>(`/issues/${issueId}/comments`, {
        body,
        bodyFormat: 'MARKDOWN',
        mentionUserIds: extractMentionIds(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.issues.comments(issueId) }),
  });
}

interface UpdateIssueVars {
  id: string;
  key: string;
  patch: Record<string, unknown>;
  version: number;
  /** Phần vá lạc quan cho field quan hệ cần cả đối tượng (vd `severity` tra từ meta, `priority`) — KHÔNG gửi lên máy chủ; bản thật thay khi trả về. */
  optimistic?: Partial<IssueDto>;
}

/**
 * `opts.silent`: tắt toast lỗi chung của MutationCache — dùng khi gọi hàng loạt (Promise.allSettled)
 * và tự gom lỗi thành MỘT thông báo tổng kết.
 */
export function useUpdateIssue(projectId: string | undefined, opts?: { silent?: boolean }) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: opts?.silent },
    mutationFn: (v: UpdateIssueVars) =>
      api.patch<IssueDto>(`/issues/${v.id}`, { ...v.patch, version: v.version }),
    // `optimistic`: phần vá lạc quan cho trường quan hệ cần cả đối tượng (vd `priority`) — KHÔNG gửi lên máy chủ.
    onMutate: (v) =>
      optimisticPatchIssue(
        qc,
        projectId,
        v.id,
        { ...scalarIssuePatch(v.patch), ...(v.optimistic ?? {}) },
        v.key,
      ),
    onSuccess: (res) => {
      // Ghi bản THẬT (version mới) vào cả chi tiết lẫn danh sách → sửa inline liên tiếp không bị 409 OCC.
      writeIssue(qc, projectId, res.data);
    },
    onError: (_e, v, snap) => {
      rollbackIssue(qc, snap);
      invalidateIssue(qc, projectId, v.key);
    },
  });
}

export function useTransitionDetail(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TransitionVars) =>
      api
        .post<IssueTransitionResultDto>(`/issues/${v.id}/transition`, {
          toStatusId: v.toStatusId,
          version: v.version,
          resolutionId: v.resolutionId,
          comment: v.comment,
        })
        .then((r) => r.data),
    onMutate: (v) => optimisticPatchIssue(qc, projectId, v.id, statusPatch(v), v.key),
    // Bản thật (kể cả khi Hoàn tác) → lớp phủ kết quả Bộ lọc (kết quả bộ lọc không nằm trong cache dự án).
    onSuccess: (updated) => recordIssueChange(updated),
    onError: (_e, _v, snap) => rollbackIssue(qc, snap),
    // Chuyển trạng thái có thể đổi resolution/resolvedAt → luôn nạp lại bản thật (hẹp: issue này + danh sách project).
    onSettled: (_r, _e, v, snap) => {
      invalidateIssue(qc, projectId, snap?.issueKey ?? v.key);
      // Lý do được máy chủ lưu thành bình luận → nạp lại danh sách bình luận.
      if (v.comment) void qc.invalidateQueries({ queryKey: keys.issues.comments(v.id) });
    },
  });
}
