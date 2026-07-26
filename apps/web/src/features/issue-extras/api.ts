import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@tirapro/types';
import { api } from '@/lib/api';

export interface ChecklistItemDto {
  id: string;
  issueId: string;
  text: string;
  done: boolean;
  order: number;
  createdAt: string;
}

export const participantsKey = (issueId: string) => ['issue-participants', issueId] as const;
export const checklistKey = (issueId: string) => ['issue-checklist', issueId] as const;

/** Người tham gia issue (ngoài người phụ trách & người báo cáo). */
export function useParticipants(issueId?: string) {
  return useQuery({
    queryKey: participantsKey(issueId ?? ''),
    queryFn: async () => (await api.get<UserDto[]>(`/issues/${issueId}/participants`)).data,
    enabled: !!issueId,
  });
}

export function useSetParticipants(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api.put<UserDto[]>(`/issues/${issueId}/participants`, { userIds }).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: participantsKey(issueId) }),
  });
}

/** Checklist trong issue. */
export function useChecklist(issueId?: string) {
  return useQuery({
    queryKey: checklistKey(issueId ?? ''),
    queryFn: async () => (await api.get<ChecklistItemDto[]>(`/issues/${issueId}/checklist`)).data,
    enabled: !!issueId,
  });
}

export function useAddChecklistItem(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      api.post<ChecklistItemDto>(`/issues/${issueId}/checklist`, { text }).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: checklistKey(issueId) }),
  });
}

export function useUpdateChecklistItem(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, ...patch }: { itemId: string; text?: string; done?: boolean; order?: number }) =>
      api.patch<ChecklistItemDto>(`/issues/${issueId}/checklist/${itemId}`, patch).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: checklistKey(issueId) }),
  });
}

export function useRemoveChecklistItem(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.delete(`/issues/${issueId}/checklist/${itemId}`).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: checklistKey(issueId) }),
  });
}
