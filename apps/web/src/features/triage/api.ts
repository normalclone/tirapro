import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse, TriageItemDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import type { AcceptPayload } from './triageLogic';

/** Hộp phân loại: issue đang chờ triage của dự án (đủ mô tả, người gửi, loại yêu cầu, môi trường để duyệt). */
export function useTriageInbox(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.triage.inbox(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          (await api.get<ListResponse<TriageItemDto>>(`/triage?projectId=${projectId}&limit=100`))
            .data.data
      : skipToken,
  });
}

/** Số lượng issue đang chờ phân loại (cho badge). */
export function useTriageCount(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.triage.count(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<{ count: number }>(`/triage/count?projectId=${projectId}`)).data
      : skipToken,
  });
}

/**
 * Sau mỗi hành động, version đổi → invalidate cả inbox + count để lấy version mới
 * (an toàn với OCC, tránh chỉnh cache tay). Ngoài ra gỡ optimistic issue khỏi inbox
 * để phản hồi tức thì, và nạp lại danh sách việc của dự án (Việc chờ/Board) vì việc vừa
 * được Nhận phải hiện ở đó (việc chờ/đã từ chối thì không).
 */
function useTriageMutation<TVars>(
  projectId: string,
  mutationFn: (vars: TVars & { issueId: string }) => Promise<unknown>,
) {
  const qc = useQueryClient();
  const inboxKey = keys.triage.inbox(projectId);
  return useMutation({
    mutationFn,
    onMutate: async (vars: TVars & { issueId: string }) => {
      await qc.cancelQueries({ queryKey: inboxKey });
      const prev = qc.getQueryData<TriageItemDto[]>(inboxKey);
      qc.setQueryData<TriageItemDto[]>(inboxKey, (old) =>
        (old ?? []).filter((i) => i.id !== vars.issueId),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(inboxKey, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: inboxKey });
      void qc.invalidateQueries({ queryKey: keys.triage.count(projectId) });
      void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
    },
  });
}

/** Nhận issue vào dự án (tùy chọn đổi loại/ưu tiên/sprint, gán người làm). */
export function useAccept(projectId: string) {
  return useTriageMutation<AcceptPayload>(projectId, ({ issueId, ...body }) =>
    api.post<TriageItemDto>(`/triage/${issueId}/accept`, body),
  );
}

/** Từ chối issue; `reason` được lưu thành bình luận và báo người gửi. */
export function useDecline(projectId: string) {
  return useTriageMutation<{ version: number; reason?: string }>(projectId, (v) =>
    api.post<TriageItemDto>(`/triage/${v.issueId}/decline`, {
      version: v.version,
      ...(v.reason ? { reason: v.reason } : {}),
    }),
  );
}

/** Tạm hoãn issue đến thời điểm `until` (ISO datetime). */
export function useSnooze(projectId: string) {
  return useTriageMutation<{ version: number; until: string }>(projectId, (v) =>
    api.post<TriageItemDto>(`/triage/${v.issueId}/snooze`, {
      version: v.version,
      until: v.until,
    }),
  );
}
