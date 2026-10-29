import type { ReactNode } from 'react';
import { useInView } from '@/lib/useInView';

/**
 * Khu nằm dưới màn hình đầu tiên: chỉ dựng (và nhờ đó chỉ gọi API) khi cuộn tới gần. Khung giữ chỗ có chiều cao tối thiểu
 * để trang không giật khi nội dung hiện ra. `id` giữ nguyên cho liên kết nhảy tới khu này.
 */
export function LazyPanel({
  children,
  id,
  minHeight = 80,
  force = false,
}: {
  children: ReactNode;
  id?: string;
  minHeight?: number;
  /** Ép dựng ngay (vd. phím tắt cần panel dù chưa cuộn tới). */
  force?: boolean;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const show = inView || force;
  return (
    <div ref={ref} id={id} style={show ? undefined : { minHeight }}>
      {show ? children : null}
    </div>
  );
}
