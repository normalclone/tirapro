import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ChevronDown, ShieldCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSignupEnabled } from './announcement';

/** Chỉ hiện tiện ích đăng nhập nhanh khi chạy dev — không lọt vào bản build production. */
const IS_DEV = import.meta.env.DEV;

const DEMO_PASSWORD = 'Password123';
/**
 * Tài khoản demo cho từng vai trò (mật khẩu chung). Chỉ dùng khi dev.
 * Lưu ý: admin demo là `admin@projira.dev` còn lại `@tirapro.dev` — giữ nguyên
 * theo dữ liệu seed (đừng "đồng bộ" domain, sẽ lệch với seed).
 */
const DEMO_ACCOUNTS: { email: string; name: string; role: string; admin?: boolean }[] = [
  { email: 'admin@projira.dev', name: 'An Quản Trị', role: 'Admin hệ thống', admin: true },
  { email: 'ba@tirapro.dev', name: 'Bình (BA)', role: 'Business Analyst' },
  { email: 'dev@tirapro.dev', name: 'Dũng (Dev)', role: 'Developer' },
  { email: 'tester@tirapro.dev', name: 'Trang (Tester)', role: 'Tester' },
];

export function LoginPage() {
  const status = useAuth((s) => s.status);
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const { enabled: signupEnabled } = useSignupEnabled();
  // Prefill tài khoản demo chỉ khi dev; production khởi tạo trống.
  const [email, setEmail] = useState(IS_DEV ? 'admin@projira.dev' : '');
  const [password, setPassword] = useState(IS_DEV ? DEMO_PASSWORD : '');
  const [loading, setLoading] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  if (status === 'authed') return <Navigate to="/" replace />;

  async function doLogin(nextEmail: string, nextPassword: string) {
    setEmail(nextEmail);
    setPassword(nextPassword);
    setLoading(true);
    try {
      await login(nextEmail, nextPassword);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid h-full place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-fg text-lg font-bold">T</div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Tirapro</h1>
            <p className="text-sm text-muted">Quản lý dự án, nhanh và tĩnh.</p>
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void doLogin(email, password); }} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-ink">Email</label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-ink">Mật khẩu</label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" loading={loading} className="w-full">Đăng nhập</Button>
        </form>

        {/* Popup tài khoản demo — chỉ khi dev (không lọt vào production) */}
        {IS_DEV && (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
          <button
            type="button"
            onClick={() => setDemoOpen((o) => !o)}
            aria-expanded={demoOpen}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <Users className="h-4 w-4 text-muted" />
            <span className="flex-1 text-left">Tài khoản demo</span>
            <ChevronDown className={cn('h-4 w-4 text-faint transition-transform', demoOpen && 'rotate-180')} />
          </button>
          {demoOpen && (
            <ul className="border-t border-border">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void doLogin(a.email, DEMO_PASSWORD)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-50"
                  >
                    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-semibold', a.admin ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted')}>
                      {a.admin ? <ShieldCheck className="h-3.5 w-3.5" /> : a.name.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{a.role}</span>
                      <span className="block truncate font-mono text-[11px] text-muted">{a.email}</span>
                    </span>
                  </button>
                </li>
              ))}
              <li className="px-3 py-2 text-[11px] text-faint">Mật khẩu chung: <span className="font-mono">{DEMO_PASSWORD}</span></li>
            </ul>
          )}
        </div>
        )}

        {signupEnabled && (
          <p className="mt-4 text-center text-sm text-muted">
            Chưa có tài khoản? <Link to="/signup" className="font-medium text-primary hover:underline">Đăng ký</Link>
          </p>
        )}
      </div>
    </div>
  );
}
