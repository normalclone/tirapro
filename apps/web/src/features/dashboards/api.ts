import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import type {
  CustomDashboardDto,
  CustomDashboardSummaryDto,
  DashboardInput,
  DashboardUpdateInput,
} from '@tirapro/shared';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Dashboard người xem thấy được (đã lọc theo 4 mức chia sẻ ở máy chủ) — `GET /dashboards`. */
export function useDashboards() {
  return useQuery({
    queryKey: keys.dashboards.list,
    queryFn: async () => (await api.get<CustomDashboardSummaryDto[]>('/dashboards')).data,
    staleTime: 30_000,
  });
}

/** Một dashboard kèm ô — `GET /dashboards/:id` (không xem được → 404). `id` rỗng/`new` thì không tải. */
export function useDashboard(id?: string) {
  return useQuery({
    queryKey: keys.dashboards.detail(id ?? ''),
    queryFn: id
      ? async () => (await api.get<CustomDashboardDto>(`/dashboards/${id}`)).data
      : skipToken,
  });
}

/** Tạo (không `id`) hoặc cập nhật (`id` + `updatedAt` đã đọc) dashboard. Xong thì nạp lại danh sách + chi tiết. */
export type SaveDashboardVars =
  | { id?: undefined; body: DashboardInput }
  | { id: string; body: DashboardUpdateInput };

export function useSaveDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: SaveDashboardVars) =>
      v.id
        ? (await api.put<CustomDashboardDto>(`/dashboards/${v.id}`, v.body)).data
        : (await api.post<CustomDashboardDto>('/dashboards', v.body)).data,
    onSuccess: (dto) => {
      qc.setQueryData(keys.dashboards.detail(dto.id), dto);
      void qc.invalidateQueries({ queryKey: keys.dashboards.list });
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete<Ack>(`/dashboards/${id}`)).data,
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: keys.dashboards.detail(id) });
      void qc.invalidateQueries({ queryKey: keys.dashboards.list });
    },
  });
}

/** Nhân bản thành dashboard RIÊNG TƯ của người xem (cách người không phải chủ "sửa" dashboard được chia sẻ). */
export function useDuplicateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<CustomDashboardDto>(`/dashboards/${id}/duplicate`)).data,
    onSuccess: (dto) => {
      qc.setQueryData(keys.dashboards.detail(dto.id), dto);
      void qc.invalidateQueries({ queryKey: keys.dashboards.list });
    },
  });
}

/** Việc khớp một câu JQL (ô ISSUE_LIST) — `GET /search?jql=&limit=`; máy chủ chỉ trả việc người xem thấy. */
export function useJqlIssues(jql: string | undefined, limit: number) {
  return useQuery({
    queryKey: keys.dashboards.jql(jql ?? '', limit),
    queryFn: jql
      ? async () =>
          (
            await api.get<ListResponse<IssueDto>>(
              `/search?jql=${encodeURIComponent(jql)}&limit=${limit}`,
            )
          ).data.data
      : skipToken,
    staleTime: 15_000,
  });
}
