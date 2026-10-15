import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/* ------------------------------------------------------------------ */
/* Kiểu dữ liệu                                                       */
/* ------------------------------------------------------------------ */

export type DigestSchedule = 'DAILY' | 'WEEKLY' | 'SPRINT_END' | 'MANUAL';

export interface Digest {
  id: string;
  name: string;
  schedule: DigestSchedule;
  projectId: string | null;
  channelId: string | null;
  metrics: string[];
  recipients: string[];
  isEnabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

export interface CreateDigestInput {
  name: string;
  schedule?: DigestSchedule;
  projectId?: string;
  channelId?: string;
  metrics?: string[];
  recipients?: string[];
}

export interface UpdateDigestInput {
  id: string;
  name?: string;
  schedule?: DigestSchedule;
  isEnabled?: boolean;
}

export interface RunDigestResult {
  sent: boolean;
  summaryText: string;
}

/* ------------------------------------------------------------------ */
/* Query keys                                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */

export function useDigests(projectId?: string) {
  return useQuery({
    queryKey: keys.digests.byProject(projectId),
    queryFn: async () =>
      (
        await api.get<Digest[]>('/digests', {
          params: projectId ? { projectId } : undefined,
        })
      ).data,
  });
}

export function useCreateDigest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDigestInput) =>
      api.post<Digest>('/digests', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.digests.all });
    },
  });
}

export function useUpdateDigest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateDigestInput) =>
      api.patch<Digest>(`/digests/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.digests.all });
    },
  });
}

export function useDeleteDigest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/digests/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.digests.all });
    },
  });
}

export function useRunDigest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<RunDigestResult>(`/digests/${id}/run`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.digests.all });
    },
  });
}
