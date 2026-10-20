import { useCallback, useEffect, useReducer, useRef } from 'react';
import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import type {
  AiAssigneeSuggestResult,
  AiCapabilities,
  AiGenerateIssuesResult,
  AiSprintPlanResult,
  AiSuggestResult,
  AiSummaryResult,
} from '@tirapro/shared';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import {
  createCancellable,
  initialRequestState,
  requestReducer,
  type RequestAction,
  type RequestState,
} from './cancellableRequest';

export interface ProjectMeta {
  projectId: string;
  issueTypes: {
    id: string;
    name: string;
    key: string | null;
    color: string | null;
    iconUrl: string | null;
    isSubtask: boolean;
    /** Cấp phân cấp (Epic = 1). Có thể thiếu ở máy chủ cũ → suy từ `key`. */
    hierarchyLevel?: number;
  }[];
  priorities: {
    id: string;
    name: string;
    color: string | null;
    rank: number;
    isDefault: boolean;
  }[];
  severities: {
    id: string;
    name: string;
    description: string | null;
    color: string | null;
    rank: number;
    isDefault: boolean;
  }[];
  resolutions: {
    id: string;
    name: string;
    description: string | null;
    rank: number;
    isDefault: boolean;
  }[];
}

/** Config tạo issue (issue types + priorities) cho quick-add / AI generate. */
export function useProjectMeta(key: string | undefined) {
  return useQuery({
    queryKey: keys.ai.projectMeta(key ?? ''),
    queryFn: key
      ? async () => (await api.get<ProjectMeta>(`/projects/${key}/meta`)).data
      : skipToken,
    staleTime: 5 * 60_000,
  });
}

/** Khả năng AI hiện tại (Claude hay heuristic). Ít đổi → staleTime dài. */
export function useAiCapabilities() {
  return useQuery({
    queryKey: keys.ai.capabilities,
    queryFn: async () => (await api.get<AiCapabilities>('/ai/capabilities')).data,
    staleTime: 5 * 60_000,
  });
}

/** Tóm tắt một issue. */
export function useSummarizeIssue() {
  return useMutation({
    mutationFn: (issueId: string) =>
      api.post<AiSummaryResult>(`/ai/issues/${issueId}/summary`).then((r) => r.data),
  });
}

const suggestReducer = (
  s: RequestState<AiSuggestResult>,
  a: RequestAction<AiSuggestResult>,
): RequestState<AiSuggestResult> => requestReducer(s, a);

/**
 * Gợi ý ưu tiên & story points (kèm nguồn) cho một issue — HUỶ ĐƯỢC phía client (không stream): `cancel()` cắt request đang
 * chờ bằng AbortController, KHÔNG báo lỗi, và phản hồi đến muộn sau khi huỷ bị bỏ qua. Chỉ lỗi thật mới gọi `onFailed`
 * (nơi gọi hiện toast). Huỷ chỉ ngừng chờ: yêu cầu đã tới máy chủ vẫn có thể tính vào hạn mức AI. Đổi issue/gỡ màn → tự huỷ.
 */
export function useSuggestIssue(issueId: string, onFailed?: (error: unknown) => void) {
  const [state, dispatch] = useReducer(suggestReducer, initialRequestState<AiSuggestResult>());
  const running = useRef<ReturnType<typeof createCancellable<AiSuggestResult>> | null>(null);
  const failed = useRef(onFailed);
  failed.current = onFailed;

  const cancel = useCallback(() => {
    running.current?.cancel();
    running.current = null;
    dispatch({ type: 'cancel' });
  }, []);

  const run = useCallback(() => {
    running.current?.cancel();
    const call = createCancellable((signal) =>
      api
        .post<AiSuggestResult>(`/ai/issues/${issueId}/suggest`, undefined, { signal })
        .then((r) => r.data),
    );
    running.current = call;
    dispatch({ type: 'start' });
    void call.start().then((o) => {
      if (o.kind === 'cancelled') return; // đã huỷ/bị thay: không hiện kết quả, không toast
      if (running.current === call) running.current = null;
      if (o.kind === 'done') dispatch({ type: 'done', value: o.value });
      else {
        dispatch({ type: 'failed', error: o.error });
        failed.current?.(o.error);
      }
    });
  }, [issueId]);

  // Đổi issue / gỡ màn: huỷ lần đang chạy (không dispatch — màn có thể đã gỡ).
  useEffect(
    () => () => {
      running.current?.cancel();
      running.current = null;
    },
    [issueId],
  );

  return {
    run,
    cancel,
    pending: state.phase === 'pending',
    data: state.phase === 'done' ? state.data : undefined,
  };
}

/** NL → danh sách issue đề xuất (preview). Hook dùng cho màn khác. */
export function useGenerateIssues() {
  return useMutation({
    mutationFn: (v: { projectId: string; text: string }) =>
      api.post<AiGenerateIssuesResult>('/ai/generate-issues', v).then((r) => r.data),
  });
}

/** Gợi ý người nhận việc cho một issue (projectId để máy chủ kiểm quyền). */
export function useSuggestAssignee() {
  return useMutation({
    meta: { silent: true }, // component tự hiển thị lỗi ngay tại chỗ
    mutationFn: (v: { projectId: string; issueId: string }) =>
      api.post<AiAssigneeSuggestResult>('/ai/suggest-assignee', v).then((r) => r.data),
  });
}

/** Trợ lý lập sprint: đề xuất việc từ backlog (không tự ghi — áp dụng qua bulk update). */
export function useSprintPlan() {
  return useMutation({
    meta: { silent: true },
    mutationFn: (v: {
      projectId: string;
      sprintId: string;
      capacityPoints?: number;
      goal?: string;
    }) => api.post<AiSprintPlanResult>('/ai/sprint-plan', v).then((r) => r.data),
  });
}
