import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationEmailPrefs } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** ---- Thông báo (notification preferences) ---- */


export interface NotificationPrefsResponse {
  preferences: Record<string, boolean>;
  defaults: Record<string, boolean>;
  /** Tuỳ chọn nhận thông báo qua email (đã gộp mặc định). */
  email: NotificationEmailPrefs;
  emailDefaults: NotificationEmailPrefs;
}

export function useNotificationPrefs() {
  return useQuery({
    queryKey: keys.notificationPrefs,
    queryFn: async () =>
      (await api.get<NotificationPrefsResponse>('/notifications/preferences')).data,
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: {
      preferences?: Partial<Record<string, boolean>>;
      email?: Partial<NotificationEmailPrefs>;
    }) => api.put<unknown>('/notifications/preferences', patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notificationPrefs });
    },
  });
}

/** ---- Mức độ nghiêm trọng (severities) ---- */


export interface Severity {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  rank: number;
  isDefault: boolean;
  isSystem: boolean;
}

export interface SeverityCreateInput {
  name: string;
  description?: string;
  color?: string;
  rank?: number;
}

export interface SeverityUpdateInput {
  name?: string;
  description?: string;
  color?: string;
  rank?: number;
  isDefault?: boolean;
}

export function useSeverities() {
  return useQuery({
    queryKey: keys.severities,
    queryFn: async () => (await api.get<Severity[]>('/severities')).data,
  });
}

export function useCreateSeverity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SeverityCreateInput) =>
      api.post<Severity>('/severities', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.severities });
    },
  });
}

export function useUpdateSeverity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SeverityUpdateInput }) =>
      api.patch<Severity>(`/severities/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.severities });
    },
  });
}

export function useDeleteSeverity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/severities/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.severities });
    },
  });
}
