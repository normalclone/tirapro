import { useState } from 'react';
import { ChevronDown, ShieldCheck, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEMO_PASSWORD = 'Password123';
/**
 * Tài khoản demo cho từng vai trò (mật khẩu chung). Chỉ dùng khi dev.
 * Lưu ý: admin demo là `admin@projira.dev` còn lại `@tirapro.dev` — giữ nguyên
 * theo dữ liệu seed (đừng "đồng bộ" domain, sẽ lệch với seed).
 */
const DEMO_ACCOUNTS: { email: string; name: string; role: string; admin?: boolean }[] = [
  { email: 'admin@projira.dev', name: 'An Quản Trị', role: 'Admin hệ thống', admin: true },
  { email: 'ba@tirapro.dev', name: 'Bình (BA)', role: 'Phân tích nghiệp vụ' },
  { email: 'dev@tirapro.dev', name: 'Dũng (Dev)', role: 'Developer' },
  { email: 'tester@tirapro.dev', name: 'Trang (Tester)', role: 'Tester' },
];

/**
 * Khối "Tài khoản demo" của trang đăng nhập — tách thành chunk riêng, `LoginPage` chỉ nạp khi
 * `SHOW_DEMO_ACCOUNTS` (xem demoLogin.ts). Mật khẩu demo chỉ nằm trong file này.
 */
export default function DemoAccounts({
  loading,
  onPick,
}: {
  loading: boolean;
  onPick: (email: string, password: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
      >
        <Users className="h-4 w-4 text-muted" />
        <span className="flex-1 text-left">Tài khoản demo</span>
        <ChevronDown
          className={cn('h-4 w-4 text-faint transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul className="border-t border-border">
          {DEMO_ACCOUNTS.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                disabled={loading}
                onClick={() => onPick(a.email, DEMO_PASSWORD)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-50"
              >
                <span
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-semibold',
                    a.admin ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted',
                  )}
                >
                  {a.admin ? <ShieldCheck className="h-3.5 w-3.5" /> : a.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{a.role}</span>
                  <span className="block truncate font-mono text-[11px] text-muted">{a.email}</span>
                </span>
              </button>
            </li>
          ))}
          <li className="px-3 py-2 text-[11px] text-faint">
            Mật khẩu chung: <span className="font-mono">{DEMO_PASSWORD}</span>
          </li>
        </ul>
      )}
    </div>
  );
}
