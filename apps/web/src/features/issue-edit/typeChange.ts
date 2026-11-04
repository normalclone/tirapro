import axios from 'axios';
import type { Workflow, WorkflowStatus } from '@/features/workflow-settings/api';

/** Máy chủ yêu cầu chọn trạng thái đích khi đổi loại việc sang loại dùng quy trình KHÁC (422 STATUS_MAPPING_REQUIRED). */
export interface StatusMappingNeeded {
  /** Trạng thái đích gợi ý (cùng tên → cùng nhóm → đầu tiên); thiếu khi quy trình mới không có trạng thái nào cùng nhóm. */
  suggestedStatusId?: string;
}

/** Bóc 422 STATUS_MAPPING_REQUIRED của `PATCH /issues/:id {typeId}`; lỗi khác → null (đi đường báo lỗi thường). */
export function statusMappingNeeded(e: unknown): StatusMappingNeeded | null {
  if (!axios.isAxiosError(e)) return null;
  const err = (
    e.response?.data as
      | {
          error?: {
            code?: string;
            details?: Array<{ field?: string; code?: string; suggestedStatusId?: string }>;
          };
        }
      | undefined
  )?.error;
  if (err?.code !== 'STATUS_MAPPING_REQUIRED') return null;
  // Thiếu `details`/gợi ý vẫn là "cần chọn trạng thái": hộp mở không chọn sẵn, người dùng tự chọn.
  const d = (err.details ?? []).find((x) => x.field === 'targetStatusId');
  return d?.suggestedStatusId ? { suggestedStatusId: d.suggestedStatusId } : {};
}

export interface TypeChangeChoices {
  /** Quy trình của loại mới (chứa trạng thái gợi ý); null khi không xác định được. */
  workflow: Workflow | null;
  /** Trạng thái chọn được, theo thứ tự quy trình. */
  statuses: WorkflowStatus[];
}

/**
 * Trạng thái để chọn trong quy trình mới: quy trình chứa trạng thái gợi ý; không có gợi ý thì dùng quy trình `fallbackWorkflowId`
 * (quy trình hiệu lực của loại mới trong dự án, tra từ cấu hình dự án). Cả hai đều không có → rỗng (hộp báo chưa tải/không chọn
 * được) — KHÔNG đoán sang quy trình nào khác để khỏi gửi trạng thái sai.
 */
export function typeChangeChoices(
  workflows: Workflow[] | undefined,
  suggestedStatusId: string | undefined,
  fallbackWorkflowId?: string | null,
): TypeChangeChoices {
  const all = workflows ?? [];
  const workflow =
    (suggestedStatusId
      ? all.find((w) => w.statuses.some((s) => s.id === suggestedStatusId))
      : undefined) ??
    (fallbackWorkflowId ? all.find((w) => w.id === fallbackWorkflowId) : undefined) ??
    null;
  return {
    workflow,
    statuses: workflow ? [...workflow.statuses].sort((a, b) => a.order - b.order) : [],
  };
}
