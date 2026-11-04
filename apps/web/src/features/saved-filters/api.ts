import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { FilterAudienceDto, IssueDto, ListResponse, SavedFilterDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { RESULT_FETCH_LIMIT, toResultSet, type ResultSet } from './resultPaging';

/** `SHARED` = có ít nhất một dự án hoặc một người được chia sẻ. */
export type FilterVisibility = 'PRIVATE' | 'SHARED';

/** Bộ lọc đã lưu (`GET /filters`): `access = 'shared'` là bộ lọc người khác chia sẻ cho tôi. */
export type SavedFilter = SavedFilterDto;

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

/**
 * "Ai xem được" một bản chia sẻ CHƯA lưu (POST /filters/audience): máy chủ tính theo đúng luật xem dự án (dự án công khai
 * → ai xem được dự án đều thấy; dự án riêng tư → thành viên + quản trị) nên số khớp với người thực sự thấy bộ lọc.
 * Chờ 300ms sau lần tích cuối; giữ số cũ trong lúc tính lại. `enabled=false` hoặc chưa chọn đích → không gọi.
 */
export function useFilterAudience(
  projectIds: readonly string[],
  userIds: readonly string[],
  enabled: boolean,
) {
  const body = JSON.stringify({
    sharedProjectIds: [...projectIds].sort(),
    sharedUserIds: [...userIds].sort(),
  });
  const settled = useDebouncedValue(body, 300);
  const hasTarget = projectIds.length + userIds.length > 0;
  const query = useQuery({
    queryKey: keys.filters.audience(settled),
    queryFn:
      enabled && hasTarget
        ? async () =>
            (await api.post<FilterAudienceDto>('/filters/audience', JSON.parse(settled))).data
        : skipToken,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
  return { ...query, pending: enabled && hasTarget && (settled !== body || query.isFetching) };
}

export interface CreateFilterInput {
  name: string;
  jql: string;
  visibility?: FilterVisibility;
  sharedProjectIds?: string[];
  sharedUserIds?: string[];
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

export interface UpdateFilterInput {
  id: string;
  name?: string;
  jql?: string;
  visibility?: FilterVisibility;
  /** Gửi cả hai danh sách khi đổi chia sẻ (`[]` = bỏ hết); không gửi = giữ nguyên. */
  sharedProjectIds?: string[];
  sharedUserIds?: string[];
}

/** Thân PATCH /filters/:id: bỏ `id` và mọi trường không đổi (máy chủ coi `undefined` là không sửa; `null` là xoá dự án). */
export function buildFilterPatch(input: UpdateFilterInput): Omit<UpdateFilterInput, 'id'> {
  const { id: _id, ...rest } = input;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
}

/** Sửa bộ lọc đã lưu — đổi tên/truy vấn hoặc đổi chia sẻ (`visibility` + hai danh sách đích) sau khi tạo. Chỉ chủ (403 nếu khác). */
export function useUpdateFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateFilterInput) =>
      (await api.patch<SavedFilter>(`/filters/${input.id}`, buildFilterPatch(input))).data,
    onSuccess: (updated) => {
      qc.setQueryData<SavedFilter[]>(keys.filters.all, (list) =>
        list?.map((f) => (f.id === updated.id ? updated : f)),
      );
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
