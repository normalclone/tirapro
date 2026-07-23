import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';

export type FilterVisibility = 'PRIVATE' | 'WORKSPACE' | 'PROJECT';

export interface SavedFilter {
  id: string;
  name: string;
  jql: string;
  visibility: FilterVisibility;
  sharedProjectId: string | null;
  ownerId: string;
  isOwner: boolean;
  createdAt: string;
}

export interface JqlValidation {
  valid: boolean;
  error?: string;
  position?: number;
}

/** Một lựa chọn cho bộ dựng truy vấn (value khớp JQL, label hiển thị). */
export interface FieldOption {
  value: string;
  label: string;
  color?: string | null;
}

/** Danh mục giá trị cho bộ lọc "đơn giản" (GET /search/fields). */
export interface FilterFields {
  types: FieldOption[];
  statuses: FieldOption[];
  priorities: FieldOption[];
  sprints: FieldOption[];
  labels: FieldOption[];
  resolutions: FieldOption[];
}

export const filtersKey = ['filters'] as const;
export const filterFieldsKey = ['filter-fields'] as const;

/** Danh mục giá trị cho bộ dựng truy vấn trực quan (gom theo workspace). */
export function useFilterFields() {
  return useQuery({
    queryKey: filterFieldsKey,
    queryFn: async () => (await api.get<FilterFields>('/search/fields')).data,
    staleTime: 5 * 60_000,
  });
}

/**
 * Chạy JQL ad-hoc qua GET /search. `enabled` để chỉ chạy khi người dùng bấm "Chạy"
 * (tránh gọi liên tục khi đang gõ). Lỗi JQL (422) được trả qua `query.error`.
 */
export function useRunJql(jql: string, enabled: boolean) {
  return useQuery({
    queryKey: ['search', jql],
    queryFn: async () =>
      (await api.get<ListResponse<IssueDto>>(`/search?jql=${encodeURIComponent(jql)}&limit=100`)).data
        .data,
    enabled: enabled && jql.trim().length > 0,
    retry: false,
  });
}

export function useSavedFilters() {
  return useQuery({
    queryKey: filtersKey,
    queryFn: async () => (await api.get<SavedFilter[]>('/filters')).data,
  });
}

export interface CreateFilterInput {
  name: string;
  jql: string;
  visibility?: FilterVisibility;
}

export function useCreateFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateFilterInput) =>
      (await api.post<SavedFilter>('/filters', input)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: filtersKey });
    },
  });
}

export function useDeleteFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/filters/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: filtersKey });
    },
  });
}

/** Chạy 1 bộ lọc đã lưu theo id (GET /filters/:id/run) — helper fetch thủ công. */
export async function runFilter(id: string): Promise<IssueDto[]> {
  return (await api.get<ListResponse<IssueDto>>(`/filters/${id}/run?limit=100`)).data.data;
}

/** Mutation chạy bộ lọc đã lưu — dùng để nạp & chạy khi bấm vào 1 bộ lọc. */
export function useRunFilter() {
  return useMutation({
    mutationFn: (id: string) => runFilter(id),
  });
}

/** Validate JQL qua POST /search/validate — helper fetch thủ công. */
export async function validateJql(jql: string): Promise<JqlValidation> {
  return (await api.post<JqlValidation>('/search/validate', { jql })).data;
}
