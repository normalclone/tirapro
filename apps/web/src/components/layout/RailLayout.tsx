import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
          'flex shrink-0 flex-col gap-2 border-b border-border bg-surface px-3 py-3',
          'lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:py-5',
          railClassName,
        )}
      >
        {rail}
      </aside>
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
