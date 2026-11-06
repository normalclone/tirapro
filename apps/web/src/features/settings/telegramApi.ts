import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { pollPlan } from '@/features/integrations/telegramWizard';

/* ------------------------------------------------------------------ */
/* Liên kết Telegram cá nhân                                           */
/* ------------------------------------------------------------------ */

export interface TelegramLinkStatus {
  /** Tổ chức có bot Telegram dùng được để liên kết không. */
  available: boolean;
  reason: 'NO_BOT' | 'PLATFORM_OFF' | null;
  botUsername: string | null;
  linked: { username: string | null; linkedAt: string } | null;
}

export interface PersonalLinkCode {
  code: string;
  expiresAt: string;
  botUsername: string | null;
  /** `https://t.me/<bot>?start=<mã>` — null nếu chưa biết @username bot. */
  deepLink: string | null;
  /** Lệnh dự phòng gõ tay trong chat với bot. */
  command: string;
}

export type PersonalLinkPoll =
  | { status: 'waiting'; hint?: string }
  | { status: 'linked'; username: string | null }
  | { status: 'expired' }
  | { status: 'error'; hint: string };

export function useTelegramLink() {
  return useQuery({
    queryKey: keys.telegramLink,
    queryFn: async () => (await api.get<TelegramLinkStatus>('/notifications/telegram')).data,
  });
}

export function useCreatePersonalLinkCode() {
  return useMutation({
    mutationFn: () =>
      api.post<PersonalLinkCode>('/notifications/telegram/link').then((r) => r.data),
  });
}

/** Hỏi server mỗi 3 giây xem `/start <mã>` đã tới bot chưa; dừng khi có kết quả cuối hoặc hết lịch (xem `pollPlan`). */
export function usePollPersonalLink(code: string | null, startedAt: number) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.telegramLinkCode(code ?? ''),
    queryFn: code
      ? async () => {
          const res = (
            await api.post<PersonalLinkPoll>(`/notifications/telegram/link/${code}/poll`)
          ).data;
          if (res.status === 'linked') void qc.invalidateQueries({ queryKey: keys.telegramLink });
          return res;
        }
      : skipToken,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && status !== 'waiting') return false;
      const plan = pollPlan(startedAt, Date.now());
      return plan.continue ? plan.intervalMs : false;
    },
    // Mỗi lần hỏi là một lệnh gọi thật tới Telegram — không giữ cache, không hỏi lại khi quay lại tab.
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useUnlinkTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<Ack>('/notifications/telegram/link').then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.telegramLink });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Kênh Telegram của dự án (Project Admin)                             */
/* ------------------------------------------------------------------ */

export interface ManagedProject {
  id: string;
  key: string;
  name: string;
}

export interface ProjectChannel {
  id: string;
  title: string | null;
  /** Rỗng = nhận tất cả sự kiện. */
  events: string[];
  isEnabled: boolean;
}

export interface ProjectTelegramOverview {
  botReady: boolean;
  reason: 'NO_BOT' | 'PLATFORM_OFF' | null;
  botUsername: string | null;
  /** Các loại sự kiện kênh nhận được. */
  eventTypes: string[];
  channels: ProjectChannel[];
}

export interface ProjectLinkCode {
  code: string;
  expiresAt: string;
  botUsername: string | null;
  command: string;
  startGroupUrl: string | null;
}

export type ProjectLinkPoll =
  | { status: 'waiting'; hint?: string }
  | { status: 'linked'; channel: { id: string; externalId: string; title: string | null } }
  | { status: 'expired' }
  | { status: 'error'; hint: string };

/** Dự án người dùng quản trị — rỗng thì mục "Kênh Telegram của dự án" không hiện. */
export function useManagedProjects() {
  return useQuery({
    queryKey: keys.projectTelegram.managed,
    queryFn: async () =>
      (await api.get<ManagedProject[]>('/notifications/telegram/managed-projects')).data,
    staleTime: 60_000,
  });
}

export function useProjectTelegram(projectId: string | null) {
  return useQuery({
    queryKey: keys.projectTelegram.overview(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<ProjectTelegramOverview>(`/projects/${projectId}/telegram`)).data
      : skipToken,
  });
}

export function useCreateProjectLinkCode(projectId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<ProjectLinkCode>(`/projects/${projectId}/telegram/link-codes`).then((r) => r.data),
  });
}

export function usePollProjectLink(projectId: string, code: string | null, startedAt: number) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.projectTelegram.linkCode(projectId, code ?? ''),
    queryFn: code
      ? async () => {
          const res = (
            await api.post<ProjectLinkPoll>(
              `/projects/${projectId}/telegram/link-codes/${code}/poll`,
            )
          ).data;
          if (res.status === 'linked')
            void qc.invalidateQueries({ queryKey: keys.projectTelegram.overview(projectId) });
          return res;
        }
      : skipToken,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && status !== 'waiting') return false;
      const plan = pollPlan(startedAt, Date.now());
      return plan.continue ? plan.intervalMs : false;
    },
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useUpdateProjectChannel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; events?: string[]; isEnabled?: boolean }) => {
      const { channelId, ...patch } = input;
      return api
        .patch<ProjectChannel>(`/projects/${projectId}/telegram/channels/${channelId}`, patch)
        .then((r) => r.data);
    },
    // Lưu ngay: cập nhật lạc quan, lỗi thì nạp lại từ máy chủ.
    onMutate: async (input) => {
      const key = keys.projectTelegram.overview(projectId);
      await qc.cancelQueries({ queryKey: key });
      qc.setQueryData<ProjectTelegramOverview>(key, (cur) =>
        cur
          ? {
              ...cur,
              channels: cur.channels.map((c) =>
                c.id === input.channelId
                  ? {
                      ...c,
                      ...(input.events ? { events: input.events } : {}),
                      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
                    }
                  : c,
              ),
            }
          : cur,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.projectTelegram.overview(projectId) });
    },
  });
}

export function useDeleteProjectChannel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      api.delete<Ack>(`/projects/${projectId}/telegram/channels/${channelId}`).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.projectTelegram.overview(projectId) });
    },
  });
}
