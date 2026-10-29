import { createContext, useContext, type RefObject } from 'react';

/**
 * Thứ tự THẬT của danh sách mà trang đang hiển thị — để panel xem nhanh biết vị trí "n/N" và bước qua cả những dòng chưa vẽ
 * (ảo hoá, trang khác của bảng phân trang). Không có → panel dùng thứ tự DOM của `[data-nav-item]`.
 */
interface PeekOrderBase {
  /** Khoá việc theo ĐÚNG thứ tự người dùng thấy (việc ẩn/thu gọn không có mặt). */
  keys: readonly string[];
  /** Phân trang: máy chủ còn kết quả ngoài `keys` (N hiển thị "50+"). */
  hasMore?: boolean;
  /** Đưa dòng `key` vào DOM/tầm nhìn khi nó chưa được vẽ (cuộn danh sách ảo hoá, sang đúng trang…). */
  reveal?: (key: string) => void;
}

/**
 * Nơi cung cấp `loadMore` BẮT BUỘC cung cấp cả `loadingMore`: thiếu nó, panel không biết đang chờ nên tự bước › sau khi nạp
 * bị huỷ ngay (kiểu bắt buộc ở đây). `loadingMore` = đang nạp trang kế (nạp xong mà không thêm dòng = thất bại).
 */
export type PeekOrder = PeekOrderBase &
  (
    | { loadMore?: undefined; loadingMore?: boolean }
    | { loadMore: () => void; loadingMore: boolean }
  );

export interface PeekContextValue {
  /** Khung chứa danh sách — phạm vi tìm dòng khi cuộn/tô và quan sát thay đổi (không dựa vào vị trí anh em của panel). */
  listRef: RefObject<HTMLElement | null>;
  order: PeekOrder | null;
}

export const PeekOrderContext = createContext<PeekContextValue>({
  listRef: { current: null },
  order: null,
});

export const usePeekContext = (): PeekContextValue => useContext(PeekOrderContext);
