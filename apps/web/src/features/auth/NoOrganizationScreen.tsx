import { useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/stores/auth';

/**
 * Màn thay cho khung ứng dụng khi tài khoản chưa thuộc tổ chức nào (vd admin hệ thống vừa tạo tài khoản
 * nhưng chưa thêm vào đâu). Không sidebar, không truy vấn theo tổ chức → không còn ô lỗi đỏ.
 */
export function NoOrganizationScreen() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <main className="grid h-full place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-lg font-bold text-primary-fg">
            T
          </div>
          <span className="text-sm text-muted">{user.displayName}</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-strong">
          Bạn chưa thuộc tổ chức nào
        </h1>
        <p className="mt-2 text-sm text-muted">
          Nhờ quản trị viên thêm bạn vào một tổ chức (gửi cho họ email{' '}
          <span className="font-medium text-ink">{user.email}</span>). Được thêm xong, đăng nhập lại
          là vào được.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {user.isSystemAdmin === true && (
            <Button variant="secondary" onClick={() => navigate('/admin/accounts')}>
              <ShieldCheck className="h-4 w-4" /> Vào trang quản trị hệ thống
            </Button>
          )}
          <Button variant="ghost" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Đăng xuất
          </Button>
        </div>
      </div>
    </main>
  );
}
