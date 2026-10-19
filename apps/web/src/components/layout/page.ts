import { cn } from '@/lib/utils';
import { pageFrameClass, type PageFrameSize } from './PageFrame';

/**
 * Wrapper mỏng giữ chỗ cho các trang CHƯA chuyển sang `<PageFrame>` (ruling RB1, đợt 2B).
 * Trang mới/đã chuyển dùng `PageFrame` + `PageHeader`; T11 xoá file này khi hết nơi gọi.
 *
 * `md` là cỡ cũ đã bỏ khỏi chuẩn B-D1: chỉ còn cho trang chưa chuyển (khi chuyển sẽ rơi vào
 * `lg`/`xl`). KHÔNG thêm chỗ dùng mới.
 */
export type PageSize = PageFrameSize | 'md';

export function pageContainer(size: PageSize, className?: string): string {
  // md = lg ghi đè bề rộng (twMerge: lớp đứng sau thắng) → giữ nguyên bề rộng cũ 896px.
  if (size === 'md') return pageFrameClass('lg', cn('max-w-4xl', className));
  return pageFrameClass(size, className);
}
