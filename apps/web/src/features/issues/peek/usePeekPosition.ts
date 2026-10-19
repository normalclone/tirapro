import { useLayoutEffect, useState, type RefObject } from 'react';
import { readNavKeys } from '@/lib/listNav';
import {
  peekPosition,
  sameNavSnapshot,
  type NavSnapshot,
  type PeekPosition,
} from '@/lib/peekPosition';

const UNKNOWN: NavSnapshot = { keys: [], partial: false };

/**
 * Vị trí của việc đang xem trong danh sách bên cạnh panel — đọc thứ tự từ DOM (cùng nguồn với `j`/`k`), cập nhật khi đổi việc
 * và khi danh sách đổi cấu trúc (thêm/xoá/dời thẻ-dòng, mở/thu khu): MutationObserver (chỉ `childList`, KHÔNG theo dõi
 * thuộc tính để kéo-thả không kích hoạt đọc lại) gộp bằng rAF; state chỉ đổi khi thứ tự thật sự khác.
 * `panelRef`: phần tử panel — danh sách là anh em đứng ngay trước (PeekShell). Không thấy → vẫn đọc một lần.
 */
export function usePeekPosition(
  peekKey: string,
  panelRef: RefObject<HTMLElement | null>,
): PeekPosition | null {
  const [snap, setSnap] = useState<NavSnapshot>(UNKNOWN);
  useLayoutEffect(() => {
    const read = () =>
      setSnap((prev) => {
        const next = readNavKeys();
        return sameNavSnapshot(prev, next) ? prev : next;
      });
    read();
    const list = panelRef.current?.previousElementSibling;
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
  }, [peekKey, panelRef]);
  return peekPosition(snap.keys, peekKey, snap.partial);
}
