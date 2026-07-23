import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* ------------------------------------------------------------------ */
/* Kiểu dữ liệu                                                       */
/* ------------------------------------------------------------------ */

export type IntegrationType = 'TELEGRAM' | 'GITHUB' | 'GITLAB';
export type IntegrationStatus = 'ACTIVE' | 'INACTIVE' | 'ERROR';

export interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  /** botToken luôn bị che thành '***' trong phản hồi. */
  config: Record<string, unknown>;
  createdAt: string;
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
}

/* ------------------------------------------------------------------ */
/* Query keys                                                         */
/* ------------------------------------------------------------------ */

export const integrationsKey = (type: IntegrationType) => ['integrations', type] as const;
export const channelsKey = (integrationId: string) =>
  ['integration-channels', integrationId] as const;
export const repositoriesKey = ['repositories'] as const;

/* ------------------------------------------------------------------ */
/* Telegram integrations                                              */
/* ------------------------------------------------------------------ */

export function useIntegrations() {
  return useQuery({
    queryKey: integrationsKey('TELEGRAM'),
    queryFn: async () =>
      (await api.get<Integration[]>('/integrations', { params: { type: 'TELEGRAM' } })).data,
  });
}

export function useCreateTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTelegramInput) =>
      api.post<Integration>('/integrations/telegram', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: integrationsKey('TELEGRAM') });
    },
  });
}

export function useDeleteIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/integrations/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: integrationsKey('TELEGRAM') });
    },
  });
}

export function useTestIntegration() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<TestResult>(`/integrations/${id}/test`).then((r) => r.data),
  });
}

/* ------------------------------------------------------------------ */
/* Channels (theo từng integration)                                   */
/* ------------------------------------------------------------------ */

export function useChannels(integrationId: string) {
  return useQuery({
    queryKey: channelsKey(integrationId),
    queryFn: async () =>
      (await api.get<Channel[]>(`/integrations/${integrationId}/channels`)).data,
    enabled: !!integrationId,
  });
}

export function useAddChannel(integrationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddChannelInput) =>
      api.post<Channel>(`/integrations/${integrationId}/channels`, input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: channelsKey(integrationId) });
    },
  });
}

export function useDeleteChannel(integrationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      api.delete(`/integrations/channels/${channelId}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: channelsKey(integrationId) });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Repositories (GitHub / GitLab)                                     */
/* ------------------------------------------------------------------ */

export function useRepositories() {
  return useQuery({
    queryKey: repositoriesKey,
    queryFn: async () => (await api.get<Repository[]>('/dev/repositories')).data,
  });
}

export function useCreateRepository() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRepositoryInput) =>
      api.post<Repository>('/dev/repositories', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: repositoriesKey });
    },
  });
}

export function useDeleteRepository() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/dev/repositories/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: repositoriesKey });
    },
  });
}
