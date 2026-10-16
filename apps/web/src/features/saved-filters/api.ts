import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

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

/** Một giá trị JQL không có trong workspace, kèm giá trị gần đúng nhất (nếu có). */
interface JqlValueSuggestion {
  field: string;
  value: string;
  didYouMean: string | null;
}

export interface JqlValidation {
  valid: boolean;
  error?: string;
  position?: number;
  suggestions?: JqlValueSuggestion[];
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
  severities: FieldOption[];
  sprints: FieldOption[];
  labels: FieldOption[];
  resolutions: FieldOption[];
  components: FieldOption[];
  versions: FieldOption[];
}

/** Danh mục giá trị cho bộ dựng truy vấn trực quan (gom theo không gian làm việc). */
export function useFilterFields() {
  return useQuery({
    queryKey: keys.filters.fields,
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
    queryKey: keys.search.jql(jql),
    queryFn:
      enabled && jql.trim().length > 0
        ? async () =>
            (
              await api.get<ListResponse<IssueDto>>(
                `/search?jql=${encodeURIComponent(jql)}&limit=100`,
              )
            ).data.data
        : skipToken,
    retry: false,
  });
}

export function useSavedFilters() {
  return useQuery({
    queryKey: keys.filters.all,
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
      void qc.invalidateQueries({ queryKey: keys.filters.all });
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
      void qc.invalidateQueries({ queryKey: keys.filters.all });
    },
  });
}

/** Chạy 1 bộ lọc đã lưu theo id (GET /filters/:id/run) — helper fetch thủ công. */
async function runFilter(id: string): Promise<IssueDto[]> {
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

/**
 * Kiểm JQL đang gõ (cú pháp + giá trị) sau 400ms ngừng gõ. Chỉ trả kết quả khi đã "đứng yên" (văn bản hiện tại
 * đúng là bản đã kiểm) để không hiện lỗi/nút sửa của câu cũ trong lúc gõ tiếp.
 */
export function useJqlValidation(jql: string) {
  const text = jql.trim();
  const debounced = useDebouncedValue(text, 400);
  const settled = text === debounced && text.length > 0;
  const query = useQuery({
    queryKey: keys.search.validate(debounced),
    queryFn: debounced.length > 0 ? () => validateJql(debounced) : skipToken,
    retry: false,
    staleTime: 30_000,
  });
  return { validation: settled ? (query.data ?? null) : null };
}
