import { ProfilePanel } from './ProfilePanel';
import { ChangePasswordPanel } from './ChangePasswordPanel';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { APP_NAV_LABELS } from '@/lib/navLabels';

/** Trang "Tài khoản" cá nhân — mở từ menu người dùng (góc phải trên). */
export function AccountPage() {
  return (
    <PageFrame size="sm">
      <PageHeader
        title={APP_NAV_LABELS.account}
        description="Hồ sơ cá nhân và mật khẩu của bạn. Những thông tin này đi theo bạn ở mọi không gian làm việc, không riêng nơi bạn đang mở."
      />

      <div className="space-y-8">
        <ProfilePanel />
        <ChangePasswordPanel />
      </div>
    </PageFrame>
  );
}
