import { useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import axios from 'axios';
import type {
  ProjectWorkflowSchemeDto,
  WorkflowChangeDto,
  WorkspaceWorkflowSchemeDto,
} from '@tirapro/types';
import type { SetProjectOverrideInput, SetWorkspaceSchemeInput } from '@tirapro/shared';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Cấu hình quy trình theo loại việc của TỔ CHỨC (chỉ Quản trị chung — API trả 403 cho người khác). */
export function useWorkspaceScheme(enabled = true) {
  return useQuery({
    queryKey: keys.workflowScheme,
    queryFn: enabled
      ? async () => (await api.get<WorkspaceWorkflowSchemeDto>('/workflow-schemes')).data
      : skipToken,
  });
}

/** Quy trình hiệu lực của từng loại việc trong MỘT dự án (ghi đè → tổ chức → mặc định của dự án). */
export function useProjectScheme(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.projectWorkflowScheme(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          (await api.get<ProjectWorkflowSchemeDto>(`/projects/${projectId}/workflow-overrides`))
            .data
      : skipToken,
  });
}

/** Một thay đổi quy trình: của tổ chức (PUT /workflow-schemes) hoặc ghi đè của một dự án (PUT /projects/:id/workflow-overrides). */
export type ChangeRequest =
  | { scope: 'workspace'; body: SetWorkspaceSchemeInput }
  | { scope: 'project'; projectId: string; body: SetProjectOverrideInput };

/** Gửi thay đổi. `dryRun` chỉ xem trước (không ghi gì). Quay về dùng chung = PUT với `workflowId: null` (không DELETE kèm body). */
export async function sendChange(req: ChangeRequest, dryRun: boolean): Promise<WorkflowChangeDto> {
  const url =
    req.scope === 'workspace'
      ? '/workflow-schemes'
      : `/projects/${req.projectId}/workflow-overrides`;
  const res = await api.put<WorkflowChangeDto>(url, req.body, {
    params: dryRun ? { dryRun: 1 } : undefined,
  });
  return res.data;
}

/** Xem trước: một truy vấn riêng (khoá khác tiền tố `workflows`), luôn lấy mới, không giữ cache sau khi đóng hộp thoại. */
export function useChangePreview(req: ChangeRequest | null) {
  return useQuery({
    queryKey: keys.workflowChangePreview(req),
    queryFn: req ? () => sendChange(req, true) : skipToken,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Sau khi áp dụng: việc đã đổi trạng thái, bảng/quy tắc đổi cột → làm mới mọi thứ phụ thuộc quy trình. */
export function useRefreshAfterChange() {
  const qc = useQueryClient();
  return (result: WorkflowChangeDto) => {
    // Trừ truy vấn xem trước (đang hiện trong hộp thoại): làm mới nó sẽ gọi dryRun thừa ngay sau khi vừa ghi.
    if (result.totalIssues > 0 || result.affectedRules.length > 0)
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'workflow-change-preview' });
    else void qc.invalidateQueries({ queryKey: keys.workflows });
  };
}

/**
 * Trường `statusMap.<id>` mà máy chủ báo còn thiếu khi 422 STATUS_MAPPING_REQUIRED — để đánh dấu đúng các dòng cần chọn.
 * Lỗi khác → mảng rỗng.
 */
export function missingMappingIds(e: unknown): string[] {
  if (!axios.isAxiosError(e)) return [];
  const err = (
    e.response?.data as
      | { error?: { code?: string; details?: Array<{ field?: string }> } }
      | undefined
  )?.error;
  if (err?.code !== 'STATUS_MAPPING_REQUIRED') return [];
  return (err.details ?? [])
    .map((d) => d.field ?? '')
    .filter((f) => f.startsWith('statusMap.'))
    .map((f) => f.slice('statusMap.'.length));
}
