import { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Undo2 } from 'lucide-react';
import type { IssueDto, PermissionKey } from '@tirapro/types';
import { canRetract, retractMinutesLeft } from './retract';

/**
 * Mục "Thu hồi công việc (còn N phút)" trong menu "Thêm": người báo xoá việc của mình ngay sau khi tạo.
 * Nằm trong nội dung menu (chỉ dựng khi menu mở) nên đồng hồ chỉ chạy lúc đang mở — mở ra là tính lại ngay.
 * Chỉ để ước lượng; server luôn là bên quyết (quá hạn/đã có bình luận → báo lỗi rõ).
 */
export function RetractMenuItem({
  issue,
  meId,
  can,
  onSelect,
}: {
  issue: Pick<IssueDto, 'reporterId' | 'createdById' | 'createdAt'>;
  meId: string | undefined;
  can: (perm: PermissionKey) => boolean;
  onSelect: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!canRetract(issue, meId, can, now)) return null;
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-danger outline-none transition-colors data-[highlighted]:bg-danger/10"
    >
      <Undo2 className="h-4 w-4 shrink-0" />
      <span className="min-w-0">
        Thu hồi công việc
        <span className="ml-1 text-xs text-muted">
          (còn {retractMinutesLeft(issue.createdAt, now)} phút)
        </span>
      </span>
    </DropdownMenu.Item>
  );
}
