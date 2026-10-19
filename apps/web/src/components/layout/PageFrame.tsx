import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Khung nội dung trang — MỘT nguồn duy nhất cho bề rộng + đệm (B-D1).
 * Nội dung mọi màn bắt đầu cùng một vị trí ngang → thao tác theo thói quen không bị lệch khi đổi màn.
 *
 *  sm   — form/danh sách hẹp (Cài đặt con, Thành viên, Thông báo, Tài khoản, Kết nối, Tự động hoá)
 *  lg   — màn làm việc vừa (chi tiết công việc, Bộ lọc, Wiki, Quản trị hệ thống, Quy trình, Vai trò & quyền)
 *  xl   — bảng mật độ cao (Tổng quan, Dự án, Bảng tổng quan, Danh mục)
 *  full — tab trong dự án (Bảng việc, Việc chờ, Lịch trình, Cây việc, Báo cáo…): theo bề ngang vùng nội dung
 *
 * Đây là nơi DUY NHẤT được đặt `max-w-*` cho khung; trang/feature không tự đặt.
 */
export const PAGE_FRAME_WIDTH = {
  sm: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-7xl',
  full: '',
} as const;

export type PageFrameSize = keyof typeof PAGE_FRAME_WIDTH;

/**
 * Lớp CSS của khung (hàm thuần để chỗ không render được — vd `pageContainer` — dùng chung).
 * Đệm: ngang 16px (mobile) / 24px (từ sm); dọc trên 24px → 32px (từ sm), dưới 32px.
 */
export function pageFrameClass(size: PageFrameSize, className?: string): string {
  return cn(
    // lg:pb-28: chừa chỗ cho nút nổi (FAB, chỉ có từ lg) để dòng cuối không bị che; dưới lg chỉ đệm pb-8.
    'mx-auto w-full px-4 pb-8 pt-6 sm:px-6 sm:pt-8 lg:pb-28',
    PAGE_FRAME_WIDTH[size],
    className,
  );
}

interface PageFrameProps extends HTMLAttributes<HTMLDivElement> {
  size: PageFrameSize;
  /** Neo tour hướng dẫn. */
  'data-tour'?: string;
}

/** Khung trang: đặt PageHeader làm con đầu tiên, nội dung phía dưới. */
export function PageFrame({ size, className, children, ...rest }: PageFrameProps) {
  return (
    <div className={pageFrameClass(size, className)} {...rest}>
      {children}
    </div>
  );
}
