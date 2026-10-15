import type { PermissionKey } from '@tirapro/types';
import { useAuth } from '@/stores/auth';
import { hasPermission } from '@/lib/permissions';

/**
 * Luật hiển thị mục điều hướng theo quyền CẤP WORKSPACE (tập quyền trong `/auth/me`).
 * Chỉ làm UI khớp quyền API — không thêm quyền mới. Quyền cấp dự án (vd `automation:manage` ở
 * một dự án) không nằm trong tập này nên đi qua tab dự án, không qua sidebar.
 */
export type NavRule = 'all' | 'systemAdmin' | { any: readonly PermissionKey[] };

export interface NavContext {
  isSystemAdmin: boolean;
  permissions: readonly string[];
}

export const NAV_RULES = {
  connect: { any: ['integration:manage', 'automation:manage', 'workspace:admin'] },
  // Tab "Ứng dụng bên ngoài" trong Kết nối (Telegram/Digest: ghi cần `integration:manage`).
  connectIntegrations: { any: ['integration:manage', 'workspace:admin'] },
  settingsGeneral: { any: ['workspace:admin'] },
  settingsImport: { any: ['workspace:admin', 'import:run'] },
  settingsApi: { any: ['workspace:admin'] },
  admin: 'systemAdmin',
} as const satisfies Record<string, NavRule>;

export function canSeeNav(rule: NavRule, ctx: NavContext): boolean {
  if (rule === 'all') return true;
  if (ctx.isSystemAdmin) return true; // admin hệ thống đi qua mọi luật
  if (rule === 'systemAdmin') return false;
  return rule.any.some((perm) => hasPermission({ workspace: ctx.permissions }, perm));
}

/** Hook mỏng quanh `useAuth`: mục có hiện với người đang đăng nhập không. */
export function useNavVisible(rule: NavRule): boolean {
  const user = useAuth((s) => s.user);
  const permissions = useAuth((s) => s.permissions);
  return canSeeNav(rule, { isSystemAdmin: user?.isSystemAdmin === true, permissions });
}

/** Giữ các mục thoả luật `rule` (mục không có `rule` luôn hiện). */
export function useVisibleItems<T extends { rule?: NavRule }>(items: readonly T[]): T[] {
  const user = useAuth((s) => s.user);
  const permissions = useAuth((s) => s.permissions);
  const ctx = { isSystemAdmin: user?.isSystemAdmin === true, permissions };
  return items.filter((i) => !i.rule || canSeeNav(i.rule, ctx));
}
