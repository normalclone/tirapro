import { ProfilePanel } from './ProfilePanel';
import { ChangePasswordPanel } from './ChangePasswordPanel';
import { pageContainer } from '@/components/layout/page';

/** Trang "Tài khoản" cá nhân — mở từ menu người dùng (góc phải trên). */
export function AccountPage() {
  return (
    <div className={pageContainer('sm')}>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Tài khoản</h1>
        <p className="mt-1 text-sm text-muted">
          Hồ sơ cá nhân và mật khẩu của bạn. Thông tin này theo bạn qua mọi workspace.
        </p>
      </header>

      <div className="space-y-8">
        <ProfilePanel />
        <ChangePasswordPanel />
      </div>
    </div>
  );
}
