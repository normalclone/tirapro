import type { PeekOrder } from '@/features/issues/peek/PeekOrderContext';

/**
 * Nguồn thứ tự của trang đang có panel xem nhanh. Phím j/k sống ở khung ứng dụng (ngoài cây React của trang nên không đọc
 * được `PeekOrderContext`) → `PeekShell` đăng ký ở đây để j/k và nút ‹ › dùng CHUNG một thứ tự. Đọc qua hàm (không chụp giá trị)
 * nên luôn là bản mới nhất.
 */
export interface PeekSource {
  /** Khung chứa danh sách (phạm vi tìm dòng); null khi chưa gắn. */
  getRoot: () => HTMLElement | null;
  /** Thứ tự thật của trang; null → dùng thứ tự DOM. */
  getOrder: () => PeekOrder | null;
}

let current: PeekSource | null = null;

/** Đăng ký nguồn của trang; trả hàm gỡ — chỉ gỡ khi nguồn hiện tại vẫn là của mình (trang mới có thể đã đăng ký trước). */
export function registerPeekSource(src: PeekSource): () => void {
  current = src;
  return () => {
    if (current === src) current = null;
  };
}

export const getPeekSource = (): PeekSource | null => current;
