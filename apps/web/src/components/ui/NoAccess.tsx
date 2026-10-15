import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/ui/primitives';
import { pageContainer } from '@/components/layout/page';

/**
 * Trang "không có quyền" — thay cho việc redirect im lặng hoặc để người dùng bấm rồi nhận 403.
 * `who` là chủ thể được phép ("quản trị hệ thống", "quản trị viên")… dùng trong mô tả.
 */
export function NoAccess({ who = 'quản trị viên' }: { who?: string }) {
  return (
    <div className={pageContainer('sm')}>
      <EmptyState
        icon={<Lock className="h-6 w-6" />}
        title="Bạn không có quyền xem trang này"
        description={`Trang này chỉ dành cho ${who}. Nếu bạn cần dùng, hãy nhờ quản trị viên cấp quyền.`}
        action={
          <Link
            to="/"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-base font-medium text-primary-fg transition-colors hover:bg-primary-hover"
          >
            Về Tổng quan
          </Link>
        }
      />
    </div>
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
