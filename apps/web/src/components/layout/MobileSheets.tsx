import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Avatar } from '@/components/ui/primitives';
import { useAuth } from '@/stores/auth';
import { useVisibleItems } from '@/lib/navAccess';
import { cn } from '@/lib/utils';
import { ADMIN_NAV, NAV_ITEMS, sheetNavItems } from '@/components/layout/navItems';
import { useAccountItems } from '@/components/layout/accountItems';
import { useCreateActions } from '@/components/layout/createActions';

/** Hàng trong sheet: cao ≥ 44px (vùng chạm), icon 20px + nhãn 14px. Hover chỉ khi có chuột (cảm ứng không bị kẹt hover sau khi chạm). */
const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-base font-medium transition-colors [@media(hover:hover)]:hover:bg-surface-2 active:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

function SheetRow({
  icon,
  label,
  onClick,
  to,
  active,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  to?: string;
  active?: boolean;
  tone?: 'default' | 'primary' | 'danger';
}) {
  const cls = cn(
    ROW,
    tone === 'primary' &&
      'bg-primary text-primary-fg [@media(hover:hover)]:hover:bg-primary-hover active:bg-primary-hover',
    tone === 'danger' && 'text-danger',
    tone === 'default' && (active ? 'bg-primary-subtle text-primary' : 'text-ink'),
  );
  const iconEl = (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center',
        tone === 'default' && !active && 'text-muted',
      )}
    >
      {icon}
    </span>
  );
  if (to)
    return (
      <Link to={to} onClick={onClick} aria-current={active ? 'page' : undefined} className={cls}>
        {iconEl}
        {label}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {iconEl}
      {label}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3 first:mt-0">
      <h3 className="px-3 pb-1 text-xs font-medium text-faint">{title}</h3>
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  );
}

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Gọi khi sheet đóng vì người dùng ĐÃ chọn một việc (đi trang khác / mở hộp thoại khác): không trả focus về ô
   * mở sheet — focus phải ở lại nơi việc đó đưa tới.
   */
  onActed: () => void;
  onCloseAutoFocus: (e: Event) => void;
}

/** Sheet "Tạo": cùng danh sách tác vụ với nút nổi desktop (`useCreateActions`), không có phím tắt. */
export function CreateSheet({ open, onOpenChange, onActed, onCloseAutoFocus }: SheetProps) {
  const actions = useCreateActions();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      placement="bottom"
      title="Tạo"
    >
      <div className="flex flex-col gap-1 pb-2">
        {actions.map((a) => (
          <SheetRow
            key={a.key}
            icon={a.icon}
            label={a.label}
            tone={a.key === 'issue' ? 'primary' : 'default'}
            onClick={() => {
              onActed();
              onOpenChange(false);
              a.perform();
            }}
          />
        ))}
      </div>
    </Dialog>
  );
}

/**
 * Sheet "Tôi": hồ sơ + các mục điều hướng KHÔNG có trên thanh tab đáy (cùng nguồn `NAV_ITEMS` + quyền với sidebar)
 * + các mục tài khoản (cùng nguồn `useAccountItems` với `UserMenu`). Chế độ admin: mục admin còn lại + "Về ứng dụng".
 */
export function MeSheet({
  open,
  onOpenChange,
  onActed,
  onCloseAutoFocus,
  admin,
}: SheetProps & { admin: boolean }) {
  const loc = useLocation();
  const user = useAuth((s) => s.user);
  const visibleNav = useVisibleItems(NAV_ITEMS, loc.pathname);
  const navItems = sheetNavItems(admin ? ADMIN_NAV : visibleNav, admin);
  // Mục "Quản trị hệ thống" đã có ở nhóm Điều hướng (hoặc đang ở chế độ admin) → không lặp ở nhóm Tài khoản.
  const account = useAccountItems().filter((i) => i.key !== 'admin');

  const done = () => {
    onActed();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      placement="bottom"
      title="Tôi"
      hideTitle
    >
      {user && (
        <div className="flex items-center gap-3 px-3 pb-3">
          <Avatar name={user.displayName} src={user.avatarUrl} size={40} />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink-strong">{user.displayName}</p>
            <p className="truncate text-sm text-faint">{user.email}</p>
          </div>
        </div>
      )}
      <Group title="Điều hướng">
        {admin && (
          <SheetRow
            to="/"
            icon={<ArrowLeft className="h-5 w-5" />}
            label="Về ứng dụng"
            onClick={done}
          />
        )}
        {navItems.map((i) => (
          <SheetRow
            key={i.to}
            to={i.to}
            icon={<i.Icon className="h-5 w-5" />}
            label={i.label}
            active={i.match(loc.pathname)}
            onClick={done}
          />
        ))}
      </Group>
      <Group title="Tài khoản">
        {account.map((i) => (
          <SheetRow
            key={i.key}
            icon={<i.Icon className="h-5 w-5" />}
            label={i.label}
            tone={i.danger ? 'danger' : 'default'}
            onClick={() => {
              // Đổi giao diện giữ sheet mở (để thấy kết quả ngay) — như UserMenu desktop.
              if (!i.keepOpen) done();
              i.onSelect();
            }}
          />
        ))}
      </Group>
    </Dialog>
  );
}
