import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';

export const triageInboxKey = (projectId: string) => ['triage-inbox', projectId] as const;
export const triageCountKey = (projectId: string) => ['triage-count', projectId] as const;

/** Hộp phân loại: issue đang chờ triage của dự án. */
export function useTriageInbox(projectId: string | undefined) {
  return useQuery({
    queryKey: triageInboxKey(projectId ?? ''),
    queryFn: async () =>
      (await api.get<ListResponse<IssueDto>>(`/triage?projectId=${projectId}&limit=100`)).data.data,
    enabled: !!projectId,
  });
}

/** Số lượng issue đang chờ phân loại (cho badge). */
export function useTriageCount(projectId: string | undefined) {
  return useQuery({
    queryKey: triageCountKey(projectId ?? ''),
    queryFn: async () => (await api.get<{ count: number }>(`/triage/count?projectId=${projectId}`)).data,
    enabled: !!projectId,
  });
}

/**
 * Sau mỗi hành động, version đổi → invalidate cả inbox + count để lấy version mới
 * (an toàn với OCC, tránh chỉnh cache tay). Ngoài ra gỡ optimistic issue khỏi inbox
 * để phản hồi tức thì.
 */
function useTriageMutation<TVars>(
  projectId: string,
  mutationFn: (vars: TVars & { issueId: string }) => Promise<unknown>,
) {
  const qc = useQueryClient();
  const inboxKey = triageInboxKey(projectId);
  return useMutation({
    mutationFn,
    onMutate: async (vars: TVars & { issueId: string }) => {
      await qc.cancelQueries({ queryKey: inboxKey });
      const prev = qc.getQueryData<IssueDto[]>(inboxKey);
      qc.setQueryData<IssueDto[]>(inboxKey, (old) => (old ?? []).filter((i) => i.id !== vars.issueId));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(inboxKey, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: inboxKey });
      void qc.invalidateQueries({ queryKey: triageCountKey(projectId) });
    },
  });
}

/** Nhận issue vào dự án (tùy chọn gán người làm). */
export function useAccept(projectId: string) {
  return useTriageMutation<{ version: number; assigneeId?: string }>(projectId, (v) =>
    api.post<IssueDto>(`/triage/${v.issueId}/accept`, {
      version: v.version,
      ...(v.assigneeId ? { assigneeId: v.assigneeId } : {}),
    }),
  );
}

/** Từ chối issue (tùy chọn lý do). */
export function useDecline(projectId: string) {
  return useTriageMutation<{ version: number; reason?: string }>(projectId, (v) =>
    api.post<IssueDto>(`/triage/${v.issueId}/decline`, {
      version: v.version,
      ...(v.reason ? { reason: v.reason } : {}),
    }),
  );
}

/** Tạm hoãn issue đến thời điểm `until` (ISO datetime). */
export function useSnooze(projectId: string) {
  return useTriageMutation<{ version: number; until: string }>(projectId, (v) =>
    api.post<IssueDto>(`/triage/${v.issueId}/snooze`, { version: v.version, until: v.until }),
  );
}
