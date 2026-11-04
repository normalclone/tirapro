import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CustomDashboardDto,
  DashboardFromTemplateInput,
  DashboardTemplate,
} from '@tirapro/shared';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

export interface DashboardTemplatesResponse {
  templates: DashboardTemplate[];
  /** Người gọi có chọn được phạm vi "toàn tổ chức" không (chỉ `organization:admin`). */
  canUseOrgScope: boolean;
}

/** Thư viện mẫu dashboard + quyền chọn phạm vi toàn tổ chức — `GET /dashboard-templates` (cần `dashboard:manage`). */
export function useDashboardTemplates(enabled = true) {
  return useQuery({
    enabled,
    queryKey: keys.dashboards.templates,
    queryFn: async () => (await api.get<DashboardTemplatesResponse>('/dashboard-templates')).data,
    staleTime: 5 * 60_000,
  });
}

/** Tạo dashboard RIÊNG TƯ từ mẫu — `POST /dashboards/from-template`. Xong thì ghi chi tiết vào cache + nạp lại danh sách. */
export function useCreateFromTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: DashboardFromTemplateInput) =>
      (await api.post<CustomDashboardDto>('/dashboards/from-template', body)).data,
    onSuccess: (dto) => {
      qc.setQueryData(keys.dashboards.detail(dto.id), dto);
      void qc.invalidateQueries({ queryKey: keys.dashboards.list });
    },
  });
}
