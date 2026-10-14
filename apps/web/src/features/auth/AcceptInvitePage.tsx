import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { passwordSchema } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { AuthPageShell } from './AuthPageShell';
import { useOneTimeToken } from './useOneTimeToken';
import { useAcceptInvite } from './mailApi';

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const token = useOneTimeToken();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const accept = useAcceptInvite();

  if (!token) {
    return (
      <AuthPageShell title="Nhận lời mời" subtitle="Liên kết không đầy đủ.">
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center">
          <p className="text-sm font-medium text-ink">Liên kết mời không hợp lệ</p>
          <p className="mt-1 text-sm text-muted">Hãy mở đúng liên kết trong thư mời, hoặc nhờ quản trị viên gửi lại lời mời.</p>
          <Link to="/login" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">Về trang đăng nhập</Link>
        </div>
      </AuthPageShell>
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (accept.isPending) return;
    const check = passwordSchema.safeParse(password);
    if (!check.success) {
      toast.error(check.error.issues[0]?.message ?? 'Mật khẩu chưa hợp lệ');
      return;
    }
    accept.mutate(
      { token, displayName: displayName.trim(), password },
      {
        onSuccess: (res) => {
          toast.success(
            res.existingUser
              ? 'Đã thêm bạn vào không gian làm việc — hãy đăng nhập bằng mật khẩu hiện có của bạn.'
              : 'Đã tạo tài khoản — hãy đăng nhập để bắt đầu.',
          );
          navigate('/login', { replace: true });
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <AuthPageShell title="Nhận lời mời" subtitle="Đặt tên và mật khẩu để vào không gian làm việc.">
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="displayName" className="text-sm font-medium text-ink">Tên hiển thị</label>
          <Input id="displayName" type="text" autoComplete="name" placeholder="Nguyễn Văn A" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-ink">Mật khẩu</label>
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <p className="text-xs text-faint">Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và chữ số.</p>
        </div>
        <p className="text-xs text-faint">Nếu email của bạn đã có tài khoản Tirapro, tên và mật khẩu ở trên sẽ được bỏ qua — bạn đăng nhập bằng mật khẩu cũ.</p>
        <Button type="submit" loading={accept.isPending} className="w-full">Chấp nhận lời mời</Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        <Link to="/login" className="font-medium text-primary hover:underline">Đã có tài khoản? Đăng nhập</Link>
      </p>
    </AuthPageShell>
  );
}
