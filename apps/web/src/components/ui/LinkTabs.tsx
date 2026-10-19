import type { HTMLAttributes } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useScrollFade } from '@/lib/useScrollFade';
import { cn } from '@/lib/utils';
import { TAB_STYLE } from './Tabs';

export interface LinkTabItem {
  /** Đường dẫn tuyệt đối của mục (mỗi mục là một route con). */
  to: string;
  label: string;
  title?: string;
}

/**
 * Hàng tab theo ROUTE (chuyển mục = đổi URL, Back của trình duyệt hoạt động): `nav` > liên kết, mục đang mở có
 * `aria-current="page"` (NavLink tự gắn). Cùng kiểu gạch chân với `Tabs`. Chuyển mục cùng trang bằng state thì dùng `Tabs`.
 * Đổi mục là đổi pathname nên `LeaveGuardHost` bắt được form chưa lưu. `fade`: cuộn ngang có mờ mép trên màn hẹp.
 */
export function LinkTabs({
  items,
  ariaLabel,
  fade = true,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, 'aria-label'> & {
  items: readonly LinkTabItem[];
  ariaLabel: string;
  fade?: boolean;
}) {
  const { pathname } = useLocation();
  const scrollFade = useScrollFade<HTMLElement>(pathname, '[aria-current="page"]');
  return (
    <nav
      {...rest}
      ref={fade ? scrollFade.ref : undefined}
      style={fade ? scrollFade.style : rest.style}
      aria-label={ariaLabel}
      className={cn(
        TAB_STYLE.list,
        fade && 'scroll-fade-x relative max-sm:overflow-x-auto max-sm:scrollbar-none',
        className,
      )}
    >
      {items.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          title={t.title}
          className={({ isActive }) =>
            cn(TAB_STYLE.base, TAB_STYLE.tab, isActive ? TAB_STYLE.on : TAB_STYLE.off)
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
