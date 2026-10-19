import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  Briefcase,
  Building2,
  Filter,
  FolderKanban,
  LayoutDashboard,
  LayoutGrid,
  Plug,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { NAV_RULES, type NavRule } from '@/lib/navAccess';
import { ADMIN_LABELS, APP_NAV_LABELS, TAB_SHORT_LABELS } from '@/lib/navLabels';

export interface NavEntry {
  to: string;
  label: string;
  /** Nhãn ngắn cho thanh tab đáy khi `label` quá dài (thanh hiện `tabLabel ?? label`, `aria-label` vẫn là `label`). */
  tabLabel?: string;
  /** Component biểu tượng — nơi dùng tự đặt cỡ (sidebar 16px, thanh tab đáy 20px). */
  Icon: LucideIcon;
  match: (p: string) => boolean;
  /** Mục chỉ hiện khi người dùng thoả luật này (xem `lib/navAccess.ts`). */
  rule?: NavRule;
}

/** Nguồn DUY NHẤT của điều hướng chính: sidebar (từ lg), thanh tab đáy và sheet "Tôi" (dưới lg) cùng đọc mảng này. */
export const NAV_ITEMS: NavEntry[] = [
  {
    to: '/',
    label: APP_NAV_LABELS.home,
    Icon: LayoutDashboard,
    match: (p) => p === '/',
  },
  {
    to: '/projects',
    label: APP_NAV_LABELS.projects,
    Icon: LayoutGrid,
    match: (p) => p.startsWith('/projects') || p.startsWith('/p/'),
  },
  {
    to: '/filters',
    label: APP_NAV_LABELS.filters,
    Icon: Filter,
    match: (p) => p.startsWith('/filters'),
  },
  {
    to: '/members',
    label: APP_NAV_LABELS.members,
    Icon: Users,
    match: (p) => p.startsWith('/members'),
  },
  {
    to: '/manage',
    label: APP_NAV_LABELS.manage,
    Icon: Briefcase,
    match: (p) => p.startsWith('/manage'),
  },
  {
    to: '/wiki',
    label: APP_NAV_LABELS.wiki,
    Icon: BookOpen,
    match: (p) => p.startsWith('/wiki'),
  },
  {
    to: '/connect',
    label: APP_NAV_LABELS.connect,
    Icon: Plug,
    match: (p) => p.startsWith('/connect'),
    rule: NAV_RULES.connect,
  },
  {
    to: '/settings',
    label: APP_NAV_LABELS.settings,
    Icon: Settings,
    match: (p) => p.startsWith('/settings'),
  },
  // Admin hệ thống: lối vào console riêng ngay trên sidebar (trước đây chỉ có trong menu người dùng).
  {
    to: '/admin',
    label: APP_NAV_LABELS.admin,
    Icon: ShieldCheck,
    match: (p) => p === '/admin' || p.startsWith('/admin/'),
    rule: NAV_RULES.admin,
  },
];

// Menu riêng cho Admin hệ thống — đứng trên mọi không gian làm việc (không gắn với nơi nào cụ thể).
export const ADMIN_NAV: NavEntry[] = [
  {
    to: '/admin',
    label: ADMIN_LABELS.overview,
    Icon: LayoutDashboard,
    match: (p) => p === '/admin',
  },
  {
    to: '/admin/workspaces',
    label: ADMIN_LABELS.workspaces,
    tabLabel: TAB_SHORT_LABELS.adminWorkspaces,
    Icon: Building2,
    match: (p) => p.startsWith('/admin/workspaces'),
  },
  {
    to: '/admin/accounts',
    label: ADMIN_LABELS.accounts,
    Icon: Users,
    match: (p) => p.startsWith('/admin/accounts'),
  },
  {
    to: '/admin/config',
    label: ADMIN_LABELS.config,
    Icon: SlidersHorizontal,
    match: (p) => p.startsWith('/admin/config'),
  },
  {
    to: '/admin/system',
    label: ADMIN_LABELS.system,
    Icon: Activity,
    match: (p) => p.startsWith('/admin/system'),
  },
];

/** Số mục điều hướng đứng trên thanh tab đáy ở chế độ admin (ô thứ 5 là "Tôi"). */
export const ADMIN_TAB_COUNT = 4;

/** Hai mục điều hướng nằm trực tiếp trên thanh tab đáy (người dùng thường): Tổng quan, Dự án (icon riêng cho thanh). */
export const USER_TAB_PATHS = ['/', '/projects'] as const;
export const USER_TAB_ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/projects': FolderKanban,
};

/** Mục điều hướng KHÔNG có trên thanh tab đáy → nằm trong sheet "Tôi". Đầu vào đã lọc theo quyền (useVisibleItems). */
export function sheetNavItems(visible: readonly NavEntry[], admin: boolean): NavEntry[] {
  return admin
    ? visible.slice(ADMIN_TAB_COUNT)
    : visible.filter((i) => !(USER_TAB_PATHS as readonly string[]).includes(i.to));
}
