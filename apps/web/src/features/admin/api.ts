import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

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
  /** Tài khoản nội bộ của tự động hoá — không có thao tác khoá / đặt lại mật khẩu. */
  isAutomation?: boolean;
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

export function useAdminUsers() {
  return useQuery({
    queryKey: keys.admin.users,
    queryFn: async () => (await api.get<ListEnvelope<AdminUser>>('/admin/users')).data.data,
  });
}

export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    // Kết quả chứa mật khẩu tạm "chỉ hiện một lần" → không giữ trong MutationCache (gcTime 0 + reset() khi đóng modal).
    gcTime: 0,
    mutationFn: async (input: CreateAdminUserInput) =>
      (await api.post<AdminUser & { tempPassword?: string }>('/admin/users', input)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.admin.users }),
  });
}

export function useUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; patch: UpdateAdminUserInput }) =>
      (await api.patch<AdminUser>(`/admin/users/${v.id}`, v.patch)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.admin.users }),
  });
}

/** Đặt lại mật khẩu: trả mật khẩu tạm "chỉ hiện một lần" → không giữ trong MutationCache. */
export function useResetAdminPassword() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (id: string) =>
      (await api.post<{ tempPassword: string }>(`/admin/users/${id}/reset-password`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.admin.users }),
  });
}

export function useRevokeAdminSessions() {
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ revoked: number }>(`/admin/users/${id}/revoke-sessions`)).data,
  });
}

/** Thêm tài khoản vào một không gian làm việc (bỏ trống vai trò → "Thành viên"). */
export function useAddAdminUserToWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { userId: string; workspaceId: string; roleIds?: string[] }) =>
      (
        await api.post<MemberDto>(`/admin/users/${v.userId}/workspaces`, {
          workspaceId: v.workspaceId,
          roleIds: v.roleIds,
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.admin.users });
      void qc.invalidateQueries({ queryKey: keys.admin.workspaces });
    },
  });
}

/* ============================ ADMIN CONSOLE ============================ */

export interface AdminOverview {
  workspaces: { total: number; active: number; archived: number };
  users: { total: number; active: number; deactivated: number; systemAdmins: number };
  projects: number;
  issues: { total: number; done: number; open: number };
  attachments: { count: number; totalBytes: number };
  ai: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    estCostUsd: number;
    successRate: number | null;
  };
  activity: { last24h: number; last7d: number };
  degrade: {
    db: boolean;
    redis: boolean;
    ai: boolean;
    aiConfigured: boolean;
    embedding: boolean;
    embeddingProvider: string;
    storage: boolean;
    storageDriver: string;
  };
  generatedAt: string;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  archived: boolean;
  createdAt: string;
  owner: { id: string; displayName: string; email: string; avatarUrl: string | null };
  members: number;
  projects: number;
  issues: number;
  lastActivityAt: string | null;
}

export interface SystemFlags {
  signupEnabled: boolean;
  aiKillSwitch: boolean;
  integrationsEnabled: boolean;
  maintenanceBanner: string;
}

export interface AdminConfig {
  nodeEnv: string;
  ai: {
    enabled: boolean;
    hasKey: boolean;
    modelPrimary: string | null;
    modelFast: string | null;
    monthlyQuotaPerWorkspace: number | null;
  };
  embedding: { provider: string; dim: number | null; hasKey: boolean };
  redis: { configured: boolean; available: boolean };
  storage: { driver: string; maxFileSizeMb: number | null; s3Bucket: string | null };
  integrations: { telegram: boolean };
  throttle: { ttl: number | null; limit: number | null };
  flags: SystemFlags;
}

export interface AdminHealth {
  db: boolean;
  dbLatencyMs: number | null;
  redis: boolean;
  redisConfigured: boolean;
  ai: boolean;
  uptimeSec: number;
  memoryRssMb: number;
  heapUsedMb: number;
  nodeEnv: string;
  release: string;
  timestamp: string;
}

/** `admin` = nhật ký quản trị (AuditLog, có `summary`); `activity` = hoạt động công việc (ActivityLog, có `field`). */
export type AuditKind = 'admin' | 'activity';

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  field?: string | null;
  summary?: string;
  createdAt: string;
  workspace: { id: string; name: string } | null;
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
}

export function useAdminOverview() {
  return useQuery({
    queryKey: keys.admin.overview,
    queryFn: async () => (await api.get<AdminOverview>('/admin/overview')).data,
  });
}

export function useAdminWorkspaces() {
  return useQuery({
    queryKey: keys.admin.workspaces,
    queryFn: async () =>
      (await api.get<ListEnvelope<AdminWorkspace>>('/admin/workspaces')).data.data,
  });
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
      void qc.invalidateQueries({ queryKey: keys.admin.workspaces });
      void qc.invalidateQueries({ queryKey: keys.admin.overview });
    },
  });
}

export function useAdminConfig() {
  return useQuery({
    queryKey: keys.admin.config,
    queryFn: async () => (await api.get<AdminConfig>('/admin/config')).data,
  });
}

export function useUpdateFlags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<SystemFlags>) =>
      (await api.put<SystemFlags>('/admin/config/flags', patch)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.admin.config }),
  });
}

export function useAdminHealth() {
  return useQuery({
    queryKey: keys.admin.health,
    queryFn: async () => (await api.get<AdminHealth>('/admin/system/health')).data,
    refetchInterval: 15_000,
  });
}

export function useAdminAudit(limit = 50, action?: string, kind: AuditKind = 'admin') {
  return useQuery({
    queryKey: keys.admin.audit(limit, action ?? '', kind),
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: String(limit), kind });
      if (action) qs.set('action', action);
      return (await api.get<ListEnvelope<AuditEntry>>(`/admin/system/audit?${qs.toString()}`)).data
        .data;
    },
  });
}
