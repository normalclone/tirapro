import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { useSignupEnabled } from './announcement';

export function SignupPage() {
  const status = useAuth((s) => s.status);
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();
  const { enabled: signupEnabled } = useSignupEnabled();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(false);

  if (status === 'authed') return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await register({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        workspaceName: workspaceName.trim() || undefined,
      });
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
            <h1 className="text-xl font-semibold tracking-tight">Tạo tài khoản</h1>
            <p className="text-sm text-muted">Bắt đầu với Tirapro trong vài giây.</p>
          </div>
        </div>

        {!signupEnabled ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center">
            <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-muted">
              <Lock className="h-5 w-5" aria-hidden />
            </div>
            <p className="text-sm font-medium text-ink">Đăng ký công khai đang tắt</p>
            <p className="mt-1 text-sm text-muted">Vui lòng liên hệ quản trị viên để được cấp tài khoản.</p>
          </div>
        ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="displayName" className="text-sm font-medium text-ink">Tên hiển thị</label>
            <Input id="displayName" type="text" autoComplete="name" placeholder="Nguyễn Văn A" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-ink">Email</label>
            <Input id="email" type="email" autoComplete="email" placeholder="ten@congty.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-ink">Mật khẩu</label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <p className="text-xs text-faint">Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và chữ số.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="workspaceName" className="text-sm font-medium text-ink">Tên workspace</label>
            <Input id="workspaceName" type="text" autoComplete="organization" placeholder="Công ty của tôi" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
          </div>
          <Button type="submit" loading={loading} className="w-full">Đăng ký</Button>
        </form>
        )}

        <p className="mt-4 text-center text-sm text-muted">
          Đã có tài khoản?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">Đăng nhập</Link>
        </p>
      </div>
    </div>
  );
}
