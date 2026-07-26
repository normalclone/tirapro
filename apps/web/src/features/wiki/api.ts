import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

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

export interface WikiPageDetail {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  body: string;
  order: number;
  createdBy: { id: string; displayName: string } | null;
  updatedBy: { id: string; displayName: string } | null;
  breadcrumb: { id: string; title: string }[];
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

/** `projectId` truyền lên API: rỗng = mọi phạm vi, `none` = tài liệu chung workspace. */
export const WIKI_SCOPE_SHARED = 'none';

export const wikiTreeKey = (scope: string) => ['wiki', 'tree', scope] as const;
export const wikiSearchKey = (scope: string, q: string) => ['wiki', 'search', scope, q] as const;
export const wikiPageKey = (id: string) => ['wiki', 'page', id] as const;

/** Cây trang theo phạm vi (`scope` rỗng = tất cả). */
export function useWikiTree(scope: string) {
  return useQuery({
    queryKey: wikiTreeKey(scope),
    queryFn: async () =>
      (await api.get<WikiNode[]>('/wiki', { params: scope ? { projectId: scope } : {} })).data,
  });
}

/** Tìm trang theo tiêu đề/nội dung. Chỉ chạy khi từ khoá ≥ 2 ký tự. */
export function useWikiSearch(scope: string, q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: wikiSearchKey(scope, term),
    queryFn: async () =>
      (
        await api.get<WikiSearchHit[]>('/wiki', {
          params: { q: term, ...(scope ? { projectId: scope } : {}) },
        })
      ).data,
    enabled: term.length >= 2,
  });
}

export function useWikiPage(id: string | null) {
  return useQuery({
    queryKey: wikiPageKey(id ?? ''),
    queryFn: async () => (await api.get<WikiPageDetail>(`/wiki/${id}`)).data,
    enabled: !!id,
  });
}

function useInvalidateWiki() {
  const qc = useQueryClient();
  return (pageId?: string) => {
    void qc.invalidateQueries({ queryKey: ['wiki', 'tree'] });
    void qc.invalidateQueries({ queryKey: ['wiki', 'search'] });
    if (pageId) void qc.invalidateQueries({ queryKey: wikiPageKey(pageId) });
  };
}

export interface CreateWikiInput {
  title: string;
  body?: string;
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
    mutationFn: ({ id, ...patch }: { id: string; title?: string; body?: string }) =>
      api.put<WikiPageDetail>(`/wiki/${id}`, patch).then((r) => r.data),
    onSuccess: (page) => invalidate(page.id),
  });
}

/** Đổi trang cha và/hoặc vị trí trong danh sách anh em (`order` = chỉ số chèn). */
export function useMoveWikiPage() {
  const invalidate = useInvalidateWiki();
  return useMutation({
    mutationFn: ({ id, parentId, order }: { id: string; parentId?: string | null; order?: number }) =>
      api.put<WikiNode[]>(`/wiki/${id}/move`, { parentId, order }).then((r) => r.data),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useDeleteWikiPage() {
  const invalidate = useInvalidateWiki();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/wiki/${id}`).then((r) => r.data),
    onSuccess: () => invalidate(),
  });
}
