import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { useSignupEnabled } from './announcement';
import { SHOW_DEMO_ACCOUNTS } from './demoLogin';

// Chỉ nạp khi cờ bật: khi `SHOW_DEMO_ACCOUNTS` là hằng `false` lúc build, Rollup loại luôn cả chunk.
const DemoAccounts = SHOW_DEMO_ACCOUNTS ? lazy(() => import('./DemoAccounts')) : null;

export function LoginPage() {
  const status = useAuth((s) => s.status);
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const { enabled: signupEnabled } = useSignupEnabled();
  // Prefill email demo chỉ khi cờ bật (mật khẩu KHÔNG bao giờ prefill ở đây — chỉ nằm trong DemoAccounts).
  const [email, setEmail] = useState(SHOW_DEMO_ACCOUNTS ? 'admin@projira.dev' : '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

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
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-fg text-lg font-bold">
            T
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Tirapro</h1>
            <p className="text-sm text-muted">Quản lý dự án, nhanh và tĩnh.</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void doLogin(email, password);
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-ink">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium text-ink">
                Mật khẩu
              </label>
              <Link
                to="/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                Quên mật khẩu?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" loading={loading} className="w-full">
            Đăng nhập
          </Button>
        </form>

        {/* Khối tài khoản demo: chỉ dev hoặc build bật VITE_SHOW_DEMO_ACCOUNTS (chunk lazy, production không có) */}
        {DemoAccounts && (
          <Suspense fallback={null}>
            <DemoAccounts loading={loading} onPick={(e, p) => void doLogin(e, p)} />
          </Suspense>
        )}

        {signupEnabled && (
          <p className="mt-4 text-center text-sm text-muted">
            Chưa có tài khoản?{' '}
            <Link to="/signup" className="font-medium text-primary hover:underline">
              Đăng ký
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
