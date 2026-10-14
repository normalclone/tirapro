import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { AuthPageShell } from './AuthPageShell';
import { useForgotPassword } from './mailApi';

export function ForgotPasswordPage() {
  const status = useAuth((s) => s.status);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const forgot = useForgotPassword();

  if (status === 'authed') return <Navigate to="/" replace />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (forgot.isPending) return;
    forgot.mutate(
      { email: email.trim() },
      { onSuccess: () => setSent(true), onError: (err) => toast.error(apiErrorMessage(err)) },
    );
  }

  return (
    <AuthPageShell title="Quên mật khẩu" subtitle="Nhập email, chúng tôi gửi liên kết để bạn đặt mật khẩu mới.">
      {sent ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center">
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-muted">
            <MailCheck className="h-5 w-5" aria-hidden />
          </div>
          <p className="text-sm font-medium text-ink">Hãy kiểm tra hộp thư của bạn</p>
          <p className="mt-1 text-sm text-muted">
            Nếu email này có tài khoản, liên kết đặt lại mật khẩu đã được gửi và có hiệu lực trong 1 giờ.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-ink">Email</label>
            <Input id="email" type="email" autoComplete="email" placeholder="ten@congty.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <Button type="submit" loading={forgot.isPending} className="w-full">Gửi liên kết đặt lại</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted">
        <Link to="/login" className="font-medium text-primary hover:underline">Quay lại đăng nhập</Link>
      </p>
    </AuthPageShell>
  );
}
