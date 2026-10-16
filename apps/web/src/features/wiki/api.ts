import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorCode, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Một nút trong cây tài liệu (không kèm nội dung — nội dung lấy ở trang chi tiết). */
export interface WikiNode {
  id: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  order: number;
  updatedAt: string;
  children: WikiNode[];
}

/** Công việc được nhắc trong trang wiki — máy chủ đã lọc theo quyền xem của người đọc. */
export interface WikiIssueRef {
  id: string;
  key: string;
  summary: string;
  typeName: string;
  statusName: string;
  statusCategory: 'TODO' | 'IN_PROGRESS' | 'DONE';
}

/** Trang wiki nhắc tới một công việc (khối "Tài liệu liên quan"). */
export interface WikiByIssue {
  id: string;
  title: string;
  projectId: string | null;
  projectKey: string | null;
  updatedAt: string;
}

export interface WikiPageDetail {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  body: string;
  order: number;
  /** Số phiên bản nội dung — gửi lại ở `expectedVersion` khi lưu (OCC). */
  version: number;
  createdBy: { id: string; displayName: string } | null;
  updatedBy: { id: string; displayName: string } | null;
  breadcrumb: { id: string; title: string }[];
  /** Công việc còn sống, người đọc xem được, có mã nằm trong nội dung trang. */
  issues: WikiIssueRef[];
  createdAt: string;
  updatedAt: string;
}

export interface WikiSearchHit {
  id: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  snippet: string;
  updatedAt: string;
}

/** `projectId` truyền lên API: rỗng = mọi phạm vi, `none` = tài liệu dùng chung cho cả tổ chức. */
export const WIKI_SCOPE_SHARED = 'none';

/** Cây trang theo phạm vi (`scope` rỗng = tất cả). */
export function useWikiTree(scope: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: keys.wiki.tree(scope),
    queryFn: async () =>
      (await api.get<WikiNode[]>('/wiki', { params: scope ? { projectId: scope } : {} })).data,
  });
}

/** Tìm trang theo tiêu đề/nội dung. Chỉ chạy khi từ khoá ≥ 2 ký tự. */
export function useWikiSearch(scope: string, q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: keys.wiki.search(scope, term),
    queryFn:
      term.length >= 2
        ? async () =>
            (
              await api.get<WikiSearchHit[]>('/wiki', {
                params: { q: term, ...(scope ? { projectId: scope } : {}) },
              })
            ).data
        : skipToken,
  });
}

export function useWikiPage(id: string | null) {
  return useQuery({
    queryKey: keys.wiki.page(id ?? ''),
    queryFn: id ? async () => (await api.get<WikiPageDetail>(`/wiki/${id}`)).data : skipToken,
  });
}

/** Các trang wiki nhắc tới công việc `issueId`. */
export function useIssueDocs(issueId: string) {
  return useQuery({
    queryKey: keys.wiki.byIssue(issueId),
    queryFn: async () => (await api.get<WikiByIssue[]>(`/wiki/by-issue/${issueId}`)).data,
  });
}

/** Người quản trị có thể cấp quyền viết / xoá trang ở phạm vi `scope` (rỗng = cấp workspace). Chỉ gọi khi `enabled`. */
export function useWikiAdmins(scope: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.wiki.admins(scope),
    queryFn: enabled
      ? async () =>
          (
            await api.get<{ id: string; displayName: string }[]>('/wiki/admins', {
              params: scope ? { projectId: scope } : {},
            })
          ).data
      : skipToken,
    staleTime: 60_000,
  });
}

function useInvalidateWiki() {
  const qc = useQueryClient();
  return (pageId?: string) => {
    void qc.invalidateQueries({ queryKey: keys.wiki.treeRoot });
    void qc.invalidateQueries({ queryKey: keys.wiki.searchRoot });
    void qc.invalidateQueries({ queryKey: keys.wiki.byIssueRoot });
    if (pageId) void qc.invalidateQueries({ queryKey: keys.wiki.page(pageId) });
  };
}

export interface CreateWikiInput {
  title: string;
  body?: string;
  /** Phạm vi của trang mới. Trang con PHẢI gửi `projectId` của trang cha (API từ chối nếu lệch). */
  projectId?: string | null;
  parentId?: string | null;
}

export function useCreateWikiPage() {
  const invalidate = useInvalidateWiki();
  return useMutation({
    mutationFn: (input: CreateWikiInput) =>
      api.post<WikiPageDetail>('/wiki', input).then((r) => r.data),
    onSuccess: (page) => invalidate(page.id),
  });
}

export function useUpdateWikiPage() {
  const invalidate = useInvalidateWiki();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      title?: string;
      body?: string;
      /** `version` của trang lúc mở sửa — API trả 409 VERSION_CONFLICT nếu người khác đã lưu trước, 404 nếu trang đã bị xoá. */
      expectedVersion?: number;
    }) => api.put<WikiPageDetail>(`/wiki/${id}`, patch).then((r) => r.data),
    onSuccess: (page) => invalidate(page.id),
    // Xung đột: làm mới bản của trang để "Huỷ → mở lại" thấy ngay nội dung người kia vừa lưu.
    onError: (e, vars) => {
      const code = apiErrorCode(e);
      if (code === 'VERSION_CONFLICT') invalidate(vars.id);
      else if (code === 'NOT_FOUND') invalidate(); // trang đã bị xoá → làm mới cây
    },
  });
}

/** Đổi trang cha và/hoặc vị trí trong danh sách anh em (`order` = chỉ số chèn). */
export function useMoveWikiPage() {
  const invalidate = useInvalidateWiki();
  return useMutation({
    mutationFn: ({
      id,
      parentId,
      order,
    }: {
      id: string;
      parentId?: string | null;
      order?: number;
    }) => api.put<WikiNode[]>(`/wiki/${id}/move`, { parentId, order }).then((r) => r.data),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useDeleteWikiPage() {
  const invalidate = useInvalidateWiki();
  return useMutation({
    mutationFn: (id: string) => api.delete<Ack>(`/wiki/${id}`).then((r) => r.data),
    onSuccess: () => invalidate(),
  });
}
