import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CreateWorkspaceModal } from '@/features/workspace/CreateWorkspaceModal';
import { useAuth } from '@/stores/auth';

/**
 * Màn thay cho khung ứng dụng khi tài khoản chưa thuộc không gian làm việc nào (vd admin hệ thống vừa tạo tài khoản
 * nhưng chưa thêm vào đâu). Không sidebar, không truy vấn theo workspace → không còn ô lỗi đỏ.
 */
export function NoWorkspaceScreen() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  if (!user) return null;
  const canCreate = !!user.canCreateWorkspace || user.isSystemAdmin === true;

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
          Bạn chưa thuộc không gian làm việc nào
        </h1>
        <p className="mt-2 text-sm text-muted">
          Nhờ quản trị viên thêm bạn vào một không gian làm việc (gửi cho họ email{' '}
          <span className="font-medium text-ink">{user.email}</span>). Được thêm xong, đăng nhập lại
          là vào được.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Building2 className="h-4 w-4" /> Tạo không gian làm việc
            </Button>
          )}
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
      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </main>
  );
}
