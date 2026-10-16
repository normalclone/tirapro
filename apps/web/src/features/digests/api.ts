import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useIntegrations, type Channel } from '@/features/integrations/api';

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
  /** userId của thành viên workspace nhận email. */
  recipients: string[];
  deliverEmail: boolean;
  /** 0 = Chủ nhật … 6 = Thứ Bảy (chỉ WEEKLY). */
  weekday: number;
  /** 0–23 theo `timezone`. */
  hour: number;
  timezone: string;
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
  deliverEmail?: boolean;
  weekday?: number;
  hour?: number;
  timezone?: string;
}

export interface UpdateDigestInput {
  id: string;
  name?: string;
  schedule?: DigestSchedule;
  isEnabled?: boolean;
  /** null = gỡ kênh Telegram. */
  channelId?: string | null;
  metrics?: string[];
  recipients?: string[];
  deliverEmail?: boolean;
  weekday?: number;
  hour?: number;
  timezone?: string;
}

export interface PreviewDigestInput {
  projectId?: string;
  metrics?: string[];
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
    mutationFn: (id: string) => api.delete<Ack>(`/digests/${id}`).then((r) => r.data),
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

/** Xem trước nội dung (chưa lưu) theo quyền xem của người bấm — văn bản thuần. */
export function usePreviewDigest() {
  return useMutation({
    mutationFn: (input: PreviewDigestInput) =>
      api.post<{ summaryText: string }>('/digests/preview', input).then((r) => r.data),
  });
}

/** Một kênh Telegram đã liên kết kèm tên tích hợp (để chọn nơi gửi digest). */
export interface DigestChannelOption {
  id: string;
  label: string;
}

/**
 * Mọi kênh Telegram ĐÃ BẬT của workspace (gộp qua các tích hợp). `loading` đúng khi còn đang tải — để giao diện
 * không vội nói "chưa có kênh".
 */
export function useDigestChannels(): { options: DigestChannelOption[]; loading: boolean } {
  const integrations = useIntegrations();
  const results = useQueries({
    queries: (integrations.data ?? []).map((i) => ({
      queryKey: keys.integrations.channels(i.id),
      queryFn: async () => (await api.get<Channel[]>(`/integrations/${i.id}/channels`)).data,
    })),
  });
  const options = (integrations.data ?? []).flatMap((i, idx) =>
    (results[idx]?.data ?? [])
      .filter((c) => c.isEnabled)
      .map((c) => ({ id: c.id, label: `${c.title ?? c.externalId} · ${i.name}` })),
  );
  return { options, loading: integrations.isLoading || results.some((r) => r.isLoading) };
}
