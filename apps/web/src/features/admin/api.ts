import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Envelope list backend trả về cho danh sách: { success, data, pageInfo, meta }. */
interface ListEnvelope<T> {
  data: T[];
}

/** User trong pool hệ thống (màn Admin hệ thống). */
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  isSystemAdmin: boolean;
  canCreateWorkspace: boolean;
  workspaceCount: number;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface CreateAdminUserInput {
  email: string;
  displayName: string;
  password?: string;
  isSystemAdmin?: boolean;
  canCreateWorkspace?: boolean;
}

export type UpdateAdminUserInput = Partial<{
  displayName: string;
  isSystemAdmin: boolean;
  canCreateWorkspace: boolean;
  status: 'ACTIVE' | 'DEACTIVATED';
}>;

const adminUsersKey = ['admin-users'] as const;

export function useAdminUsers() {
  return useQuery({
    queryKey: adminUsersKey,
    queryFn: async () => (await api.get<ListEnvelope<AdminUser>>('/admin/users')).data.data,
  });
}

export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAdminUserInput) =>
      (await api.post<AdminUser & { tempPassword?: string }>('/admin/users', input)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminUsersKey }),
  });
}

export function useUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; patch: UpdateAdminUserInput }) =>
      (await api.patch<AdminUser>(`/admin/users/${v.id}`, v.patch)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminUsersKey }),
  });
}

/* ============================ ADMIN CONSOLE ============================ */

export interface AdminOverview {
  workspaces: { total: number; active: number; archived: number };
  users: { total: number; active: number; deactivated: number; systemAdmins: number };
  projects: number;
  issues: { total: number; done: number; open: number };
  attachments: { count: number; totalBytes: number };
  ai: { requests: number; inputTokens: number; outputTokens: number; estCostUsd: number; successRate: number | null };
  activity: { last24h: number; last7d: number };
  degrade: {
    db: boolean; redis: boolean; ai: boolean; aiConfigured: boolean;
    embedding: boolean; embeddingProvider: string; storage: boolean; storageDriver: string;
  };
  generatedAt: string;
}

export interface AdminWorkspace {
  id: string; name: string; slug: string; plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  archived: boolean; createdAt: string;
  owner: { id: string; displayName: string; email: string; avatarUrl: string | null };
  members: number; projects: number; issues: number; lastActivityAt: string | null;
}

export interface SystemFlags {
  signupEnabled: boolean;
  aiKillSwitch: boolean;
  integrationsEnabled: boolean;
  maintenanceBanner: string;
}

export interface AdminConfig {
  nodeEnv: string;
  ai: { enabled: boolean; hasKey: boolean; modelPrimary: string | null; modelFast: string | null; monthlyQuotaPerWorkspace: number | null };
  embedding: { provider: string; dim: number | null; hasKey: boolean };
  redis: { configured: boolean; available: boolean };
  storage: { driver: string; maxFileSizeMb: number | null; s3Bucket: string | null };
  integrations: { telegram: boolean };
  throttle: { ttl: number | null; limit: number | null };
  flags: SystemFlags;
}

export interface AdminHealth {
  db: boolean; dbLatencyMs: number | null; redis: boolean; redisConfigured: boolean; ai: boolean;
  uptimeSec: number; memoryRssMb: number; heapUsedMb: number; nodeEnv: string; release: string; timestamp: string;
}

export interface AuditEntry {
  id: string; action: string; entityType: string; entityId: string; field: string | null; createdAt: string;
  workspace: { id: string; name: string } | null;
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
}

export function useAdminOverview() {
  return useQuery({ queryKey: ['admin-overview'], queryFn: async () => (await api.get<AdminOverview>('/admin/overview')).data });
}

export function useAdminWorkspaces() {
  return useQuery({ queryKey: ['admin-workspaces'], queryFn: async () => (await api.get<ListEnvelope<AdminWorkspace>>('/admin/workspaces')).data.data });
}

export interface PatchWorkspacePayload {
  plan?: 'FREE' | 'PRO' | 'ENTERPRISE';
  archived?: boolean;
  ownerId?: string;
}
export function usePatchWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; patch: PatchWorkspacePayload }) =>
      (await api.patch<AdminWorkspace>(`/admin/workspaces/${v.id}`, v.patch)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-workspaces'] });
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
  });
}

export function useAdminConfig() {
  return useQuery({ queryKey: ['admin-config'], queryFn: async () => (await api.get<AdminConfig>('/admin/config')).data });
}

export function useUpdateFlags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<SystemFlags>) => (await api.put<SystemFlags>('/admin/config/flags', patch)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-config'] }),
  });
}

export function useAdminHealth() {
  return useQuery({
    queryKey: ['admin-health'],
    queryFn: async () => (await api.get<AdminHealth>('/admin/system/health')).data,
    refetchInterval: 15_000,
  });
}

export function useAdminAudit(limit = 50, action?: string) {
  return useQuery({
    queryKey: ['admin-audit', limit, action ?? ''],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (action) qs.set('action', action);
      return (await api.get<ListEnvelope<AuditEntry>>(`/admin/system/audit?${qs.toString()}`)).data.data;
    },
  });
}
