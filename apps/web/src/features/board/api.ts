import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import type {
  BoardDto,
  BoardType,
  IssueDto,
  ListResponse,
  ProjectWorkflowSchemeDto,
  SwimlaneBy,
} from '@tirapro/types';
import { api } from '@/lib/api';
import type { Workflow, WorkflowStatus } from '@/features/workflow-settings/api';
import { keys } from '@/lib/queryKeys';
import { invalidateIssue, optimisticPatchIssue, rollbackIssue } from '@/lib/optimistic';

export function useBoards(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.boards.byProject(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<BoardDto[]>(`/boards?projectId=${projectId}`)).data
      : skipToken,
  });
}

/**
 * Việc của board CÓ bộ lọc JQL (`GET /boards/:id/issues`). Board không lọc không dùng hook này —
 * nó đọc thẳng `useProjectIssues` (cache chung, được realtime vá).
 */
export function useBoardIssues(boardId: string | undefined) {
  return useQuery({
    queryKey: keys.issues.byBoard(boardId ?? ''),
    queryFn: boardId
      ? async () =>
          (await api.get<ListResponse<IssueDto>>(`/boards/${boardId}/issues?limit=200`)).data.data
      : skipToken,
  });
}

/** Trạng thái kèm quy trình chứa nó — cột bảng có thể gom trạng thái của nhiều quy trình (Bug / Task / Epic dùng quy trình khác nhau). */
export interface ProjectStatus extends WorkflowStatus {
  workflowId: string;
  workflowName: string;
}

/**
 * Trạng thái của MỌI quy trình đang dùng trong dự án (theo loại việc: ghi đè của dự án → tổ chức → mặc định của dự án),
 * mỗi quy trình theo thứ tự trạng thái — để gán vào cột trong cài đặt bảng. Dự án chưa có cấu hình theo loại → quy trình
 * riêng của dự án như trước đây.
 */
export function useProjectStatuses(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.projectWorkflow(projectId ?? ''),
    queryFn: projectId
      ? async (): Promise<ProjectStatus[]> => {
          const [scheme, all] = await Promise.all([
            api.get<ProjectWorkflowSchemeDto>(`/projects/${projectId}/workflow-overrides`),
            api.get<Workflow[]>('/workflows'),
          ]);
          // Theo thứ tự loại việc trong cấu hình (cột/danh sách ổn định), không theo thứ tự trả về của `/workflows`.
          const byId = new Map(all.data.map((w) => [w.id, w]));
          const usedIds = [...new Set(scheme.data.items.map((i) => i.workflowId))];
          let list = usedIds.flatMap((id) => byId.get(id) ?? []);
          if (list.length === 0)
            list = (await api.get<Workflow[]>(`/workflows?projectId=${projectId}`)).data.slice(
              0,
              1,
            );
          return list.flatMap((w) =>
            [...w.statuses]
              .sort((a, b) => a.order - b.order)
              .map((s) => ({ ...s, workflowId: w.id, workflowName: w.name })),
          );
        }
      : skipToken,
  });
}

export interface BoardColumnInput {
  id?: string;
  name: string;
  statusIds: string[];
  wipLimit: number | null;
}

export interface BoardPatch {
  name?: string;
  filterJql?: string | null;
  swimlaneBy?: SwimlaneBy;
  /** Đổi loại bảng Scrum ↔ Kanban (`PATCH /boards/:id` `{ type }`). */
  type?: BoardType;
}

/** Sau khi sửa bảng: làm mới danh sách bảng + việc của bảng lọc (bộ lọc/cột đổi thì tập việc đổi). */
function useRefreshBoard(projectId: string) {
  const qc = useQueryClient();
  return (boardId: string) => {
    void qc.invalidateQueries({ queryKey: keys.boards.byProject(projectId) });
    void qc.invalidateQueries({ queryKey: keys.issues.byBoard(boardId) });
  };
}

/** Sửa tên / bộ lọc JQL / swimlane / loại bảng. Dialog tự báo lỗi (apiErrorMessage) nên không toast chung hai lần. */
export function useUpdateBoard(projectId: string, boardId: string) {
  const refresh = useRefreshBoard(projectId);
  return useMutation({
    mutationFn: (patch: BoardPatch) =>
      api.patch<BoardDto>(`/boards/${boardId}`, patch).then((r) => r.data),
    onSuccess: () => refresh(boardId),
  });
}

/** Thay toàn bộ cột (thứ tự mảng = thứ tự cột). */
export function useSetBoardColumns(projectId: string, boardId: string) {
  const refresh = useRefreshBoard(projectId);
  return useMutation({
    mutationFn: (columns: BoardColumnInput[]) =>
      api.put<BoardDto>(`/boards/${boardId}/columns`, { columns }).then((r) => r.data),
    onSuccess: () => refresh(boardId),
  });
}

/** Cột đã đầy giới hạn WIP (máy chủ trả mã `WIP_LIMIT_REACHED`)? */
export function isWipLimitError(e: unknown): boolean {
  return (
    axios.isAxiosError(e) &&
    (e.response?.data as { error?: { code?: string } } | undefined)?.error?.code ===
      'WIP_LIMIT_REACHED'
  );
}

/** Biến của mutation chuyển trạng thái (dùng chung board + trang chi tiết). */
export interface TransitionVars {
  id: string;
  toStatusId: string;
  version: number;
  /** Tên cột/trạng thái đích — để card hiện đúng tên ngay khi vá lạc quan. */
  statusName?: string;
  /** Mã issue — không bắt buộc, thiếu thì lấy từ cache danh sách. */
  key?: string;
  /** Bảng đang thao tác — máy chủ dùng để kiểm giới hạn WIP của cột đích. */
  boardId?: string;
  /** "Vẫn chuyển" khi cột đầy WIP (chỉ quản trị dự án được dùng). */
  force?: boolean;
  /** Cách giải quyết khi vào Done (không gửi = máy chủ dùng mặc định của tổ chức). */
  resolutionId?: string | null;
  /** Lý do/ghi chú — máy chủ lưu thành bình luận. */
  comment?: string;
}

/** Vá lạc quan trạng thái của issue (giữ category cũ; bản thật về sau sẽ thay). */
export const statusPatch =
  (v: TransitionVars) =>
  (i: IssueDto): Partial<IssueDto> => ({
    status: { ...i.status, id: v.toStatusId, name: v.statusName ?? i.status.name },
  });

/** Optimistic transition: di chuyển card sang cột mới NGAY, rollback nếu lỗi. */
export function useTransitionIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TransitionVars) =>
      api
        .post<IssueDto>(`/issues/${v.id}/transition`, {
          toStatusId: v.toStatusId,
          version: v.version,
          boardId: v.boardId,
          force: v.force,
        })
        .then((r) => r.data),
    onMutate: (v) => optimisticPatchIssue(qc, projectId, v.id, statusPatch(v), v.key),
    onError: (_e, _v, snap) => rollbackIssue(qc, snap),
    onSettled: (_r, _e, v, snap) => invalidateIssue(qc, projectId, snap?.issueKey ?? v.key),
  });
}
