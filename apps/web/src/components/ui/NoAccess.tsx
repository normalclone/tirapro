import { Link } from 'react-router-dom';
import { StatusPanel } from '@/components/ui/StatusPanel';
import { buttonVariants } from '@/components/ui/Button';
import { PageFrame } from '@/components/layout/PageFrame';

/**
 * Trang "không có quyền" — thay cho việc redirect im lặng hoặc để người dùng bấm rồi nhận 403.
 * `who` là chủ thể được phép ("quản trị hệ thống", "quản trị viên")… dùng trong mô tả.
 */
export function NoAccess({ who = 'quản trị viên' }: { who?: string }) {
  return (
    <PageFrame size="sm">
      <StatusPanel
        variant="forbidden"
        title="Bạn không có quyền xem trang này"
        description={`Trang này chỉ dành cho ${who}. Nếu bạn cần dùng, hãy nhờ quản trị viên cấp quyền.`}
        actions={
          <Link to="/" className={buttonVariants({ variant: 'primary' })}>
            Về Tổng quan
          </Link>
        }
      />
    </PageFrame>
  );
}

/** Một dòng mờ báo người dùng chỉ có quyền xem (ẩn các nút ghi). */
export function ReadOnlyNote() {
  return (
    <p className="mb-4 text-sm text-faint" role="note">
      Bạn chỉ có quyền xem — nhờ quản trị chung để thay đổi.
    </p>
  );
}
