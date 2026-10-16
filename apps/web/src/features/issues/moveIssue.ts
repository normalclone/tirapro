import { useRef } from 'react';
import {
  useMutation,
  useMutationState,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import axios from 'axios';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { api, apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import {
  invalidateIssue,
  optimisticPatchIssue,
  rollbackIssue,
  writeIssue,
  type IssueSnapshot,
} from '@/lib/optimistic';
import type { PendingMove } from '@/lib/rankOrder';

export interface MoveVars {
  id: string;
  key: string;
  version: number;
  /** Mốc ngay TRÊN / ngay DƯỚI (null = không có). */
  afterId: string | null;
  beforeId: string | null;
  /** Board: đổi trạng thái cùng lúc (cột khác). */
  statusId?: string;
  statusName?: string;
  /** undefined = giữ sprint; null = về Backlog. */
  sprintId?: string | null;
  boardId?: string;
  force?: boolean;
  /** 'move' = POST /issues/:id/move (issue:transition) · 'rank' = POST /issues/:id/rank (đòi CẢ backlog:manage + issue:edit). 'move' cũng nhận mốc rank + sprintId nếu có issue:edit đầy đủ hoặc backlog:manage (đổi sprint: issue:edit, `:own` với việc của mình). */
  route: 'move' | 'rank';
}

const moveMutationKey = (projectId: string) => ['issue-move', projectId] as const;

export function apiErrorCode(e: unknown): string | undefined {
  return axios.isAxiosError(e)
    ? (e.response?.data as { error?: { code?: string } } | undefined)?.error?.code
    : undefined;
}
export const isRankStaleError = (e: unknown) => apiErrorCode(e) === 'RANK_NEIGHBORS_STALE';

/** Vá lạc quan: chỉ status/sprint (rank KHÔNG vá — thứ tự do `applyPendingOrder`). */
export const movePatch =
  (v: MoveVars) =>
  (i: IssueDto): Partial<IssueDto> => ({
    ...(v.statusId
      ? { status: { ...i.status, id: v.statusId, name: v.statusName ?? i.status.name } }
      : {}),
    ...(v.sprintId !== undefined ? { sprintId: v.sprintId } : {}),
  });

/**
 * `version` gửi đi = phiên bản của việc trong cache NGAY TRƯỚC khi bản vá lạc quan của lần này (chụp ở `onMutate`), không phải
 * `v.version` lấy lúc thả/bấm. Cache đã gồm bản vá lạc quan của các lần kéo trước còn xếp hàng (mỗi lần +1, đúng bằng version
 * máy chủ sau khi chúng xong), nên kéo cùng thẻ lần hai khi lần một chưa trả về, hay Hoàn tác sau khi đã kéo tiếp (version trong
 * toast đã cũ), đều gửi đúng version thay vì VERSION_CONFLICT. Không có trong cache thì dùng `v.version`.
 * (Không đọc cache ở `mutationFn`: lúc đó đã chồng thêm bản vá lạc quan của chính lần này nên cao hơn máy chủ 1.)
 */
const sendVersion = new WeakMap<MoveVars, number>();

function bodyOf(v: MoveVars) {
  return {
    version: sendVersion.get(v) ?? v.version,
    afterId: v.afterId,
    beforeId: v.beforeId,
    ...(v.route === 'move' && v.statusId ? { statusId: v.statusId } : {}),
    ...(v.sprintId !== undefined ? { sprintId: v.sprintId } : {}),
    ...(v.route === 'move' && v.boardId ? { boardId: v.boardId } : {}),
    ...(v.route === 'move' && v.force ? { force: true } : {}),
  };
}

export function moveMutationOptions(qc: QueryClient, projectId: string) {
  return {
    mutationKey: moveMutationKey(projectId),
    // Mọi lần kéo của một dự án chạy lần lượt: hai request song song có thể đến server đảo thứ tự → VERSION_CONFLICT.
    scope: { id: `issue-move:${projectId}` },
    mutationFn: (v: MoveVars) =>
      api.post<IssueDto>(`/issues/${v.id}/${v.route}`, bodyOf(v)).then((r) => r.data),
    onMutate: async (v: MoveVars) => {
      const snap = await optimisticPatchIssue(qc, projectId, v.id, movePatch(v), v.key);
      if (snap.prevListItem) sendVersion.set(v, snap.prevListItem.version);
      return snap;
    },
    onSuccess: (dto: IssueDto, v: MoveVars) => {
      writeIssue(qc, projectId, dto);
      // Đổi sprint/trạng thái đổi số liệu sprint (số việc, điểm).
      if (v.sprintId !== undefined || v.statusId)
        void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
    },
    onError: (e: unknown, v: MoveVars, snap: IssueSnapshot | undefined) => {
      rollbackIssue(qc, snap);
      // MỌI lỗi đều nạp lại: kéo cùng một việc hai lần liên tiếp rồi lần sau lỗi (mạng/403/…) — rollback chỉ trả bản
      // trước lần vá đó (rank đã đổi bởi lần trước, có thể cũng chưa lên server) nên cache có thể giữ rank sai.
      invalidateIssue(qc, projectId, snap?.issueKey ?? v.key);
      // Mốc cũ: thông báo của ERROR_MESSAGES hứa "danh sách đã được nạp lại" → danh sách dự án được nạp lại THẬT
      // (rank của nhiều issue đã đổi). Một toast nhẹ, id cố định để nhiều lỗi liên tiếp chỉ hiện một; gọi
      // apiErrorMessage đánh dấu lỗi đã báo nên MutationCache không toast đôi.
      if (isRankStaleError(e)) toast.info(apiErrorMessage(e), { id: 'rank-stale' });
    },
  };
}

export function useMoveIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation(moveMutationOptions(qc, projectId));
}

/** Các lần kéo đang chờ (kể cả đang xếp hàng) của dự án — để vẽ thứ tự lạc quan. Tham chiếu ổn định khi nội dung không đổi. */
export function usePendingMoves(projectId: string | undefined): PendingMove[] {
  const vars = useMutationState({
    filters: { mutationKey: moveMutationKey(projectId ?? ''), status: 'pending' },
    select: (m) => m.state.variables as MoveVars,
  });
  const sig = vars
    .map((v) => `${v.id}\u0001${v.afterId ?? ''}\u0001${v.beforeId ?? ''}`)
    .join('\u0002');
  const prev = useRef<{ sig: string; value: PendingMove[] }>({ sig: '', value: [] });
  if (prev.current.sig !== sig)
    prev.current = {
      sig,
      value: vars.map(({ id, afterId, beforeId }) => ({ id, afterId, beforeId })),
    };
  return prev.current.value;
}
