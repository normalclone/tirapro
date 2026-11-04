import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Khung nội dung trang — MỘT nguồn duy nhất cho đệm (B-D1) và, từ Task 12, bề rộng ĐỒNG NHẤT: mọi trang lấp đầy
 * vùng nội dung (không còn khung căn giữa co lại). Nội dung mọi màn bắt đầu cùng một vị trí ngang.
 *
 * Tham số `size` vẫn giữ để chỗ gọi không đổi và để nói ý định của trang:
 *  sm   — form/danh sách (Cài đặt con, Thành viên, Thông báo, Tài khoản, Kết nối, Tự động hoá). Mang lớp `form-measure`:
 *         ô nhập một dòng / ô văn bản dài trong trang này giữ bề rộng đọc được (36rem) thay vì kéo hết 1600px;
 *         bảng, danh sách, thẻ, biểu đồ vẫn trải hết.
 *  lg · xl · full — màn làm việc / bảng / tab trong dự án: không giới hạn.
 *
 * Trang chữ dài (Wiki, Hướng dẫn) tự giữ cột chữ ~75ch ở CHÍNH cột bài viết; menu bên, thanh công cụ vẫn trải hết.
 */
export const PAGE_FRAME_WIDTH = {
  sm: '',
  lg: '',
  xl: '',
  full: '',
} as const;

export type PageFrameSize = keyof typeof PAGE_FRAME_WIDTH;

/**
 * Lớp CSS của khung (hàm thuần để chỗ không render được dùng chung).
 * Đệm: ngang 16px (mobile) / 24px (từ sm); dọc trên 24px → 32px (từ sm), dưới 32px.
 */
export function pageFrameClass(size: PageFrameSize, className?: string): string {
  return cn(
    // lg:pb-28: chừa chỗ cho nút nổi (FAB, chỉ có từ lg) để dòng cuối không bị che; dưới lg chỉ đệm pb-8.
    'mx-auto w-full px-4 pb-8 pt-6 sm:px-6 sm:pt-8 lg:pb-28',
    PAGE_FRAME_WIDTH[size],
    size === 'sm' && 'form-measure',
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
