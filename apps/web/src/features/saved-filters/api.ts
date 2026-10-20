import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { RESULT_FETCH_LIMIT, toResultSet, type ResultSet } from './resultPaging';

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

/** Một trang kết quả JQL ad-hoc (GET /search); `cursor` = `endCursor` của trang trước. */
export async function fetchJqlPage(jql: string, cursor?: string | null): Promise<ResultSet> {
  const q = `jql=${encodeURIComponent(jql)}&limit=${RESULT_FETCH_LIMIT}${
    cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
  }`;
  return toResultSet((await api.get<ListResponse<IssueDto>>(`/search?${q}`)).data);
}

/**
 * Chạy JQL ad-hoc qua GET /search. `enabled` để chỉ chạy khi người dùng bấm "Chạy"
 * (tránh gọi liên tục khi đang gõ). Lỗi JQL (422) được trả qua `query.error`.
 * Trả trang ĐẦU kèm `hasMore`/`nextCursor` — trang kế nạp bằng `fetchJqlPage`.
 */
export function useRunJql(jql: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.search.jql(jql),
    queryFn: enabled && jql.trim().length > 0 ? () => fetchJqlPage(jql) : skipToken,
    retry: false,
  });
}

/** Kết quả POST /search/relax-counts: số việc khi bỏ TỪNG điều kiện AND ở gốc của JQL không ra kết quả. */
export interface RelaxCounts {
  /** Số việc khớp JQL gốc; null = không tính/quá hạn. */
  total: number | null;
  clauses: RelaxClauseCount[];
  /** Số điều kiện vượt giới hạn đếm của máy chủ (không được thử). */
  remaining: number;
}

export interface RelaxClauseCount {
  /** Điều kiện (chữ thuần, hiển thị nguyên văn). */
  text: string;
  /** JQL khi bỏ điều kiện này — nạp thẳng vào ô JQL, FE không tự cắt chuỗi. */
  jqlWithout: string;
  /** null = đếm không kịp. */
  count: number | null;
}

/**
 * Gợi ý nới bộ lọc khi không có kết quả (092). Chỉ gọi khi `enabled`; lỗi (kể cả máy chủ cũ chưa có endpoint) → không có
 * gợi ý, không toast: đây là phần phụ của trạng thái trống.
 */
export function useRelaxCounts(jql: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.search.relax(jql),
    queryFn: enabled
      ? async ({ signal }) =>
          (await api.post<RelaxCounts>('/search/relax-counts', { jql }, { signal })).data
      : skipToken,
    retry: false,
    staleTime: 60_000,
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

/** Một trang kết quả của bộ lọc đã lưu (GET /filters/:id/run); `cursor` = `endCursor` của trang trước. */
export async function fetchFilterPage(id: string, cursor?: string | null): Promise<ResultSet> {
  const q = `limit=${RESULT_FETCH_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  return toResultSet((await api.get<ListResponse<IssueDto>>(`/filters/${id}/run?${q}`)).data);
}

/** Mutation chạy bộ lọc đã lưu — dùng để nạp & chạy khi bấm vào 1 bộ lọc (trang đầu). */
export function useRunFilter() {
  return useMutation({
    mutationFn: (id: string) => fetchFilterPage(id),
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
