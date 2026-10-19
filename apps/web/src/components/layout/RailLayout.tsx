import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { RAIL_SURFACE, RAIL_WIDTH } from './railSurface';

/**
 * Khung master–detail có rail trái (Bộ lọc, Wiki): rail là DANH SÁCH ĐỘNG (tìm/xoá/cây trang) chứ không phải menu
 * tĩnh nên KHÔNG "bước vào" như `SubNavLayout` — từ `lg` là rail dọc 288px sát mép trái (cùng chất liệu `bg-surface
 * border-r` với SubNavLayout, không bọc card viền); dưới `lg` rail xếp trên nội dung, nơi dùng tự cho nó thu/mở
 * (accordion) để không đẩy nội dung chính xuống.
 *
 * Rail KHÔNG chứa heading cấp 1: h1 thuộc `PageHeader` trong `children` (đặt trong `PageFrame`).
 */
export function RailLayout({
  ariaLabel,
  rail,
  children,
  railClassName,
}: {
  ariaLabel: string;
  rail: ReactNode;
  children: ReactNode;
  railClassName?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside
        aria-label={ariaLabel}
        className={cn(
          RAIL_SURFACE,
          RAIL_WIDTH.master,
          // Dưới lg rail xếp trên nội dung: viền dưới thay viền phải, đệm dọc gọn hơn.
          'flex flex-col gap-2 border-b py-3 lg:border-b-0',
          railClassName,
        )}
      >
        {rail}
      </aside>
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
