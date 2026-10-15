import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BulkUpdateIssuesResult, IssueDto, SprintDto } from '@tirapro/types';
import axios from 'axios';
import { api, apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { invalidateIssue, optimisticPatchIssue, rollbackIssue, writeIssue } from '@/lib/optimistic';

export function useProjectSprints(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.sprints.byProject(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<SprintDto[]>(`/sprints?projectId=${projectId}`)).data
      : skipToken,
  });
}

/** Invalidate cả sprints + issues của project sau mỗi mutation. */
function useInvalidateBacklog(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
    void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
    // Báo cáo sprint (tổng kết, burndown, velocity) phụ thuộc đúng những thứ vừa đổi.
    void qc.invalidateQueries({ queryKey: keys.reports.all });
  };
}

export function useCreateSprint(projectId: string) {
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    mutationFn: (v: { name: string; goal?: string; startDate?: string; endDate?: string }) =>
      api.post<SprintDto>('/sprints', { projectId, ...v }).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export interface StartSprintRequest {
  sprintId: string;
  startDate?: string | null;
  endDate?: string | null;
  goal?: string | null;
}

/** Ngày/mục tiêu (tuỳ chọn) đi cùng request để máy chủ áp trong MỘT giao dịch với việc chuyển ACTIVE. */
export function postStartSprint(v: StartSprintRequest): Promise<SprintDto> {
  const { sprintId, ...body } = v;
  return api.post<SprintDto>(`/sprints/${sprintId}/start`, body).then((r) => r.data);
}

export function useStartSprint(projectId: string) {
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    mutationFn: postStartSprint,
    onSuccess: invalidate,
  });
}

/** Nơi chuyển việc chưa xong khi hoàn thành sprint (khớp `completeSprintSchema` ở máy chủ). */
export type MoveIncompleteTo = 'backlog' | 'new' | { sprintId: string };

/**
 * Báo cáo của dự án mà việc kết thúc `sprintId` làm đổi. Các query này KHÔNG active khi đang ở Việc chờ nên
 * `invalidate` chỉ đánh dấu stale: trang tổng kết sẽ chớp bản cache cũ (sprint còn ACTIVE) rồi mới nhảy sang
 * CLOSED. Xoá hẳn khỏi cache để trang đó hiện khung chờ rồi dữ liệu đúng.
 */
export function sprintReportKeys(projectId: string, sprintId: string) {
  return [
    keys.reports.sprints(projectId),
    keys.reports.sprintSummary(sprintId),
    keys.reports.burndown(sprintId),
    keys.reports.velocity(projectId),
    keys.reports.project(projectId),
  ];
}

export function useCompleteSprint(projectId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    mutationFn: (v: { sprintId: string; moveIncompleteTo?: MoveIncompleteTo }) =>
      api
        .post<SprintDto>(`/sprints/${v.sprintId}/complete`, {
          moveIncompleteTo: v.moveIncompleteTo ?? 'backlog',
        })
        .then((r) => r.data),
    onSuccess: (_sprint, v) => {
      invalidate();
      for (const queryKey of sprintReportKeys(projectId, v.sprintId))
        qc.removeQueries({ queryKey });
    },
  });
}

/** Sửa sprint: FUTURE sửa được mọi trường; ACTIVE chỉ mục tiêu + ngày kết thúc (máy chủ kiểm). */
export function useUpdateSprint(projectId: string) {
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    mutationFn: (v: {
      id: string;
      patch: {
        name?: string;
        goal?: string | null;
        startDate?: string | null;
        endDate?: string | null;
      };
    }) => api.patch<SprintDto>(`/sprints/${v.id}`, v.patch).then((r) => r.data),
    onSuccess: invalidate,
  });
}

/** Xoá sprint FUTURE — việc trong sprint về Backlog. */
export function useDeleteSprint(projectId: string) {
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/sprints/${id}`).then(() => undefined),
    onSuccess: invalidate,
  });
}

/** Phần thay đổi áp cho cả lô issue (khớp `bulkUpdateIssuesSchema` ở máy chủ). */
export interface BulkIssuePatch {
  statusId?: string;
  assigneeId?: string | null;
  priorityId?: string | null;
  sprintId?: string | null;
}

/** Máy chủ nhận tối đa 100 việc/lần (`bulkUpdateIssuesSchema`). */
export const BULK_CHUNK = 100;

/**
 * Kết quả gộp các lô. `unsent` = số việc CHƯA được gửi/xử lý vì một lô sau bị lỗi (đã nằm trong `conflicts`);
 * `error` = lỗi của lô thất bại đầu tiên (chỉ có khi `unsent > 0`).
 */
export type BulkChunksResult = BulkUpdateIssuesResult & { unsent: number; error?: unknown };

/** Lý do máy chủ TỪ CHỐI một lô (403, WIP, validate…): thử lại vô ích. Lỗi mạng/không có phản hồi → `null` (thử lại được). */
export function rejectionReason(error: unknown): string | null {
  return axios.isAxiosError(error) && error.response ? apiErrorMessage(error) : null;
}

/**
 * Câu mô tả (theo SỐ conflict và số chưa gửi) phần "chưa xong" của một lần bulk. Phải tách việc chưa gửi được
 * khỏi conflict thật (người khác sửa trước — cần tải lại), kẻo báo sai nguyên nhân. `rejection` (từ
 * `rejectionReason`) có thì nêu nó thay cho "thử lại".
 */
export function bulkShortfallHint(
  conflicts: number,
  unsent: number,
  rejection?: string | null,
): string {
  const edited = Math.max(0, conflicts - unsent);
  if (unsent > 0 && edited === 0) return rejection ?? 'Một số việc chưa gửi được — thử lại.';
  if (unsent > 0)
    return `${rejection ?? 'Một số việc chưa gửi được.'} Ngoài ra ${edited} việc bị người khác sửa trước — hãy tải lại trang rồi thử lại.`;
  return 'Người khác vừa sửa những việc đó — hãy tải lại trang để xem bản mới nhất rồi thử lại.';
}

/**
 * Gửi tuần tự từng lô (không song song: OCC + WIP cần khoá theo lô). Lô đầu lỗi → ném nguyên văn
 * (chưa ghi gì). Lô sau lỗi → dừng, không ném: trả phần đã xong, phần còn lại (kể cả lô lỗi) vào `conflicts`
 * và đếm trong `unsent` để UI không nhầm với conflict do người khác sửa.
 */
export async function runBulkInChunks(
  items: Array<{ id: string; version: number }>,
  send: (chunk: Array<{ id: string; version: number }>) => Promise<BulkUpdateIssuesResult>,
  size = BULK_CHUNK,
): Promise<BulkChunksResult> {
  const out: BulkChunksResult = { updated: [], conflicts: [], unsent: 0 };
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    try {
      const r = await send(chunk);
      out.updated.push(...r.updated);
      out.conflicts.push(...r.conflicts);
    } catch (err) {
      if (i === 0) throw err;
      const rest = items.slice(i);
      out.conflicts.push(...rest.map((x) => ({ id: x.id, version: x.version })));
      out.unsent = rest.length;
      out.error = err;
      return out;
    }
  }
  return out;
}

/**
 * Sửa hàng loạt, tuần tự theo lô ≤ 100 việc/request (`BULK_CHUNK`). Kết quả: `updated` (kèm version mới của máy chủ — dùng cho "Hoàn tác")
 * và `conflicts` (việc bị người khác sửa trước, không làm hỏng cả lô).
 */
export function useBulkUpdateIssues(projectId: string) {
  const invalidate = useInvalidateBacklog(projectId);
  return useMutation({
    // Im lặng: trang tự gom lỗi/conflict thành một toast tổng kết (khớp cơ chế `meta.silent` của MutationCache).
    meta: { silent: true },
    mutationFn: (v: { items: Array<{ id: string; version: number }>; patch: BulkIssuePatch }) =>
      runBulkInChunks(v.items, (items) =>
        api
          .patch<BulkUpdateIssuesResult>('/issues/bulk', { projectId, items, patch: v.patch })
          .then((r) => r.data),
      ),
    onSettled: invalidate,
  });
}

/**
 * Di chuyển issue sang sprint khác (hoặc backlog khi sprintId === null).
 * Optimistic: cập nhật danh sách issues ngay, rollback nếu lỗi (vd OCC conflict).
 */
/** `opts.silent`: tắt toast lỗi chung (gọi hàng loạt tự tổng kết lỗi). */
export function useMoveToSprint(projectId: string, opts?: { silent?: boolean }) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: opts?.silent },
    mutationFn: (v: { id: string; sprintId: string | null; version: number }) =>
      api
        .patch<IssueDto>(`/issues/${v.id}`, { sprintId: v.sprintId, version: v.version })
        .then((r) => r.data),
    onMutate: (v) => optimisticPatchIssue(qc, projectId, v.id, { sprintId: v.sprintId }),
    onSuccess: (issue) => writeIssue(qc, projectId, issue),
    onError: (_e, _v, snap) => {
      rollbackIssue(qc, snap);
      invalidateIssue(qc, projectId, snap?.issueKey);
    },
    // Số issue/điểm của sprint đổi theo → luôn nạp lại danh sách sprint.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
    },
  });
}
