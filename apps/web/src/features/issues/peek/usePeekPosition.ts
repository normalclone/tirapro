import { useLayoutEffect, useState } from 'react';
import { readNavKeys } from '@/lib/listNav';
import {
  peekPosition,
  sameNavSnapshot,
  type NavSnapshot,
  type PeekPosition,
} from '@/lib/peekPosition';
import { usePeekContext } from './PeekOrderContext';

const UNKNOWN: NavSnapshot = { keys: [], partial: false };

/**
 * Vị trí của việc đang xem trong danh sách của trang.
 * - Trang cung cấp thứ tự thật (`PeekOrder` qua context): dùng nó — `peekPosition(order.keys, peekKey, false, …)`: N đúng cả với
 *   dòng chưa vẽ (ảo hoá, trang khác), "n/N+" khi còn kết quả chưa nạp.
 * - Không có: đọc thứ tự DOM trong KHUNG danh sách của context (không phụ thuộc vị trí của panel — panel có thể ở portal), cập nhật
 *   khi đổi việc và khi danh sách đổi cấu trúc: MutationObserver (chỉ `childList`, KHÔNG theo dõi thuộc tính để kéo-thả
 *   không kích hoạt đọc lại) gộp bằng rAF; state chỉ đổi khi thứ tự thật sự khác. `partial` → ẩn "n/N" (xem `readNavKeys`).
 */
export function usePeekPosition(peekKey: string): PeekPosition | null {
  const { listRef, order } = usePeekContext();
  const [snap, setSnap] = useState<NavSnapshot>(UNKNOWN);
  const hasOrder = order !== null;
  useLayoutEffect(() => {
    if (hasOrder) return;
    const root = listRef.current ?? document;
    const read = () =>
      setSnap((prev) => {
        const next = readNavKeys(root);
        return sameNavSnapshot(prev, next) ? prev : next;
      });
    read();
    const list = listRef.current;
    if (!list) return;
    let raf = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    });
    observer.observe(list, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [peekKey, hasOrder, listRef]);
  if (order)
    return peekPosition(order.keys, peekKey, false, {
      more: !!order.hasMore,
      canLoadMore: !!order.loadMore,
    });
  return peekPosition(snap.keys, peekKey, snap.partial);
}
