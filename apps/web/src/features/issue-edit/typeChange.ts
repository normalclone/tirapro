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
  const d = (err.details ?? []).find((x) => x.field === 'targetStatusId');
  if (!d) return null;
  return d.suggestedStatusId ? { suggestedStatusId: d.suggestedStatusId } : {};
}

export interface TypeChangeChoices {
  /** Quy trình của loại mới (chứa trạng thái gợi ý); null khi không xác định được. */
  workflow: Workflow | null;
  /** Trạng thái chọn được, theo thứ tự quy trình. */
  statuses: WorkflowStatus[];
}

/**
 * Trạng thái để chọn trong quy trình mới: quy trình chứa trạng thái gợi ý. Không có gợi ý → rỗng (hộp báo không chọn được,
 * người dùng đổi loại ở nơi khác / báo quản trị) — KHÔNG đoán sang quy trình nào khác để khỏi gửi trạng thái sai.
 */
export function typeChangeChoices(
  workflows: Workflow[] | undefined,
  suggestedStatusId: string | undefined,
): TypeChangeChoices {
  const workflow = suggestedStatusId
    ? ((workflows ?? []).find((w) => w.statuses.some((s) => s.id === suggestedStatusId)) ?? null)
    : null;
  return {
    workflow,
    statuses: workflow ? [...workflow.statuses].sort((a, b) => a.order - b.order) : [],
  };
}
