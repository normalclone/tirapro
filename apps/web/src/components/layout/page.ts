import { cn } from '@/lib/utils';

/**
 * Container chuẩn cho nội dung trang — MỘT nguồn duy nhất cho bề rộng + padding.
 * Mục tiêu: nội dung mọi màn bắt đầu ở cùng vị trí ngang → thao tác theo thói quen
 * (muscle memory) không bị lệch khi chuyển màn.
 *
 *  sm — form/cài đặt/danh sách hẹp (Settings, Members, Roles, Integrations, Account…)
 *  md — danh sách chính (Projects)
 *  lg — màn làm việc rộng (Issue detail, Filters, Workflow)
 *  xl — bảng điều khiển mật độ cao (Dashboard) — dùng gần hết bề ngang
 *
 * Trang full-bleed có header riêng (Board, Backlog, Gantt…) KHÔNG dùng token này.
 */
const PAGE_SIZES = {
  sm: 'max-w-3xl',
  md: 'max-w-4xl',
  lg: 'max-w-5xl',
  xl: 'max-w-7xl',
} as const;

export type PageSize = keyof typeof PAGE_SIZES;

export function pageContainer(size: PageSize, className?: string): string {
  return cn(
    // pb-28: chừa chỗ cho nút nổi (FAB) để dòng cuối không bị che.
    'mx-auto w-full px-4 pb-28 pt-6 sm:px-6 sm:pt-8',
    PAGE_SIZES[size],
    className,
  );
}
