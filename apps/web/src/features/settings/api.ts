import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** ---- Thông báo (notification preferences) ---- */

export const notificationPrefsKey = ['notification-preferences'] as const;

export interface NotificationPrefsResponse {
  preferences: Record<string, boolean>;
  defaults: Record<string, boolean>;
}

export function useNotificationPrefs() {
  return useQuery({
    queryKey: notificationPrefsKey,
    queryFn: async () =>
      (await api.get<NotificationPrefsResponse>('/notifications/preferences')).data,
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: Partial<Record<string, boolean>>) =>
      api
        .put<Record<string, boolean>>('/notifications/preferences', { preferences })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationPrefsKey });
    },
  });
}

/** ---- Mức độ nghiêm trọng (severities) ---- */

export const severitiesKey = ['severities'] as const;

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
    queryKey: severitiesKey,
    queryFn: async () => (await api.get<Severity[]>('/severities')).data,
  });
}

export function useCreateSeverity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SeverityCreateInput) =>
      api.post<Severity>('/severities', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: severitiesKey });
    },
  });
}

export function useUpdateSeverity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SeverityUpdateInput }) =>
      api.patch<Severity>(`/severities/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: severitiesKey });
    },
  });
}

export function useDeleteSeverity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/severities/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: severitiesKey });
    },
  });
}
