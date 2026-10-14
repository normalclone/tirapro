import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { passwordSchema } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { AuthPageShell } from './AuthPageShell';
import { useOneTimeToken } from './useOneTimeToken';
import { useResetPassword } from './mailApi';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const token = useOneTimeToken();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const reset = useResetPassword();

  if (!token) {
    return (
      <AuthPageShell title="Đặt lại mật khẩu" subtitle="Liên kết không đầy đủ.">
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center">
          <p className="text-sm font-medium text-ink">Liên kết đặt lại mật khẩu không hợp lệ</p>
          <p className="mt-1 text-sm text-muted">Hãy mở đúng liên kết trong thư, hoặc yêu cầu một liên kết mới.</p>
          <Link to="/forgot-password" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">Yêu cầu liên kết mới</Link>
        </div>
      </AuthPageShell>
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (reset.isPending) return;
    const check = passwordSchema.safeParse(password);
    if (!check.success) {
      toast.error(check.error.issues[0]?.message ?? 'Mật khẩu chưa hợp lệ');
      return;
    }
    if (password !== confirm) {
      toast.error('Hai mật khẩu chưa khớp — hãy nhập lại cho giống nhau.');
      return;
    }
    reset.mutate(
      { token, newPassword: password },
      {
        onSuccess: () => {
          toast.success('Đã đặt lại mật khẩu — hãy đăng nhập bằng mật khẩu mới.');
          navigate('/login', { replace: true });
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <AuthPageShell title="Đặt lại mật khẩu" subtitle="Chọn mật khẩu mới cho tài khoản của bạn.">
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-ink">Mật khẩu mới</label>
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <p className="text-xs text-faint">Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và chữ số.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirm" className="text-sm font-medium text-ink">Nhập lại mật khẩu</label>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <Button type="submit" loading={reset.isPending} className="w-full">Đặt lại mật khẩu</Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        <Link to="/login" className="font-medium text-primary hover:underline">Quay lại đăng nhập</Link>
      </p>
    </AuthPageShell>
  );
}
