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

/** Người đăng nhập là admin hệ thống không. */
export function useIsSystemAdmin(): boolean {
  return useAuth((s) => s.user?.isSystemAdmin === true);
}

type Gated = { rule?: NavRule; match?: (p: string) => boolean };

/**
 * Giữ các mục thoả luật `rule` (mục không có `rule` luôn hiện). Có `pathname`: mục đang đứng trên đó vẫn hiện
 * (để sáng lên) dù thiếu quyền — vd người chỉ quản trị một dự án vào Tự động hoá từ tab dự án; trừ mục chỉ dành admin hệ thống.
 */
export function filterNavItems<T extends Gated>(
  items: readonly T[],
  ctx: NavContext,
  pathname?: string,
): T[] {
  return items.filter(
    (i) =>
      !i.rule ||
      canSeeNav(i.rule, ctx) ||
      (pathname !== undefined && i.rule !== 'systemAdmin' && !!i.match?.(pathname)),
  );
}

/** `filterNavItems` với quyền của người đang đăng nhập. */
export function useVisibleItems<T extends Gated>(items: readonly T[], pathname?: string): T[] {
  const user = useAuth((s) => s.user);
  const permissions = useAuth((s) => s.permissions);
  return filterNavItems(
    items,
    { isSystemAdmin: user?.isSystemAdmin === true, permissions },
    pathname,
  );
}
