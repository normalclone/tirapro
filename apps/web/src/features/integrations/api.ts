import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { pollPlan } from './telegramWizard';

/* ------------------------------------------------------------------ */
/* Kiểu dữ liệu                                                       */
/* ------------------------------------------------------------------ */

export type IntegrationType = 'TELEGRAM' | 'GITHUB' | 'GITLAB';
export type IntegrationStatus = 'ACTIVE' | 'INACTIVE' | 'ERROR';

export type TelegramHealthState =
  | 'READY'
  | 'NO_CHANNEL'
  | 'NO_BOT'
  | 'TOKEN_ERROR'
  | 'PLATFORM_OFF';

export interface TelegramHealth {
  state: TelegramHealthState;
  label: string;
  hint: string;
}

export interface TelegramLastTest {
  at: string;
  ok: boolean;
  sent: number;
  total: number;
}

export interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  /** botToken luôn bị che thành '***' trong phản hồi. */
  config: Record<string, unknown>;
  createdAt: string;
  /** @username của bot (null nếu chưa biết). */
  botUsername: string | null;
  /** Trạng thái thật do server tính lúc đọc. */
  health: TelegramHealth;
  lastTest: TelegramLastTest | null;
}

export interface PlatformTelegram {
  platformEnabled: boolean;
  globalBotAvailable: boolean;
  globalBotUsername: string | null;
}

export interface Channel {
  id: string;
  externalId: string;
  title: string | null;
  /** Tên NotificationType. Rỗng = nhận tất cả. */
  events: string[];
  isEnabled: boolean;
}

export type RepositoryProvider = 'GITHUB' | 'GITLAB';

export interface Repository {
  id: string;
  provider: RepositoryProvider;
  name: string;
  url: string;
  defaultBranch: string | null;
  projectId: string | null;
  isEnabled: boolean;
  hasWebhookSecret: boolean;
}

export interface CreateTelegramInput {
  name: string;
  botToken?: string;
}

export interface AddChannelInput {
  externalId: string;
  title?: string;
  events?: string[];
  projectId?: string;
}

export interface CreateRepositoryInput {
  integrationId: string;
  provider: RepositoryProvider;
  externalId: string;
  name: string;
  url: string;
  defaultBranch?: string;
  projectId?: string;
  webhookSecret?: string;
}

export interface TestResult {
  sent: number;
  total: number;
  enabled: boolean;
  ok: boolean;
  /** Có mặt khi không thể gửi vì cấu hình (không phải lỗi gửi). */
  reason?: 'NO_CHANNEL' | 'NO_BOT' | 'PLATFORM_OFF';
}

/* ------------------------------------------------------------------ */
/* Query keys                                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Telegram integrations                                              */
/* ------------------------------------------------------------------ */

export function useIntegrations() {
  return useQuery({
    queryKey: keys.integrations.byType('TELEGRAM'),
    queryFn: async () =>
      (await api.get<Integration[]>('/integrations', { params: { type: 'TELEGRAM' } })).data,
  });
}

/** Cờ hệ thống + bot chung — wizard biết có cho chọn "bot chung" không. */
export function usePlatformTelegram() {
  return useQuery({
    queryKey: keys.integrations.platform,
    queryFn: async () => (await api.get<PlatformTelegram>('/integrations/telegram/platform')).data,
    staleTime: 60_000,
  });
}

export function useCreateTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTelegramInput) =>
      api.post<Integration>('/integrations/telegram', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.integrations.byType('TELEGRAM') });
    },
  });
}

export function useDeleteIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<Ack>(`/integrations/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.integrations.byType('TELEGRAM') });
    },
  });
}

export function useTestIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<TestResult>(`/integrations/${id}/test`).then((r) => r.data),
    // Kết quả gần nhất nằm trong danh sách kết nối.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.integrations.byType('TELEGRAM') });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Mã liên kết nhóm (/link@bot MÃ)                                    */
/* ------------------------------------------------------------------ */

export interface LinkCode {
  code: string;
  expiresAt: string;
  botUsername: string | null;
  command: string;
  startGroupUrl: string | null;
}

export type LinkPoll =
  | { status: 'waiting'; hint?: string }
  | { status: 'linked'; channel: { id: string; externalId: string; title: string | null } }
  | { status: 'expired' }
  | { status: 'error'; hint: string };

export function useCreateLinkCode(integrationId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<LinkCode>(`/integrations/${integrationId}/link-codes`, {}).then((r) => r.data),
  });
}

/**
 * Hỏi server mỗi 3 giây xem mã đã được gõ trong nhóm chưa; dừng khi có kết quả cuối (linked/expired/error)
 * hoặc quá 180 giây kể từ `startedAt`. Server không giữ trạng thái chờ.
 */
export function usePollLinkCode(integrationId: string, code: string | null, startedAt: number) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.integrations.linkCode(integrationId, code ?? ''),
    queryFn: code
      ? async () => {
          const res = (
            await api.post<LinkPoll>(`/integrations/${integrationId}/link-codes/${code}/poll`)
          ).data;
          if (res.status === 'linked') {
            void qc.invalidateQueries({ queryKey: keys.integrations.byType('TELEGRAM') });
            void qc.invalidateQueries({ queryKey: keys.integrations.channels(integrationId) });
          }
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

/* ------------------------------------------------------------------ */
/* Channels (theo từng integration)                                   */
/* ------------------------------------------------------------------ */

export function useChannels(integrationId: string) {
  return useQuery({
    queryKey: keys.integrations.channels(integrationId),
    queryFn: integrationId
      ? async () => (await api.get<Channel[]>(`/integrations/${integrationId}/channels`)).data
      : skipToken,
  });
}

export function useAddChannel(integrationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddChannelInput) =>
      api.post<Channel>(`/integrations/${integrationId}/channels`, input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.integrations.channels(integrationId) });
      void qc.invalidateQueries({ queryKey: keys.integrations.byType('TELEGRAM') });
    },
  });
}

export function useDeleteChannel(integrationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      api.delete<Ack>(`/integrations/channels/${channelId}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.integrations.channels(integrationId) });
      void qc.invalidateQueries({ queryKey: keys.integrations.byType('TELEGRAM') });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Repositories (GitHub / GitLab)                                     */
/* ------------------------------------------------------------------ */

export function useRepositories() {
  return useQuery({
    queryKey: keys.integrations.repositories,
    queryFn: async () => (await api.get<Repository[]>('/dev/repositories')).data,
  });
}

export function useCreateRepository() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRepositoryInput) =>
      api.post<Repository>('/dev/repositories', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.integrations.repositories });
    },
  });
}

export function useDeleteRepository() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<Ack>(`/dev/repositories/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.integrations.repositories });
    },
  });
}
