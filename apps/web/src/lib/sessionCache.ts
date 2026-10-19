import { queryClient } from './queryClient';

const cleaners = new Set<() => void>();

/**
 * Cache ngoài react-query cũng thuộc về PHIÊN (vd blob URL ảnh đính kèm): đăng ký ở đây để bị xoá cùng lúc với
 * `queryClient` khi đăng xuất / đổi workspace — không rò dữ liệu sang tài khoản đăng nhập sau trên cùng tab.
 */
export function registerSessionCleaner(fn: () => void): void {
  cleaners.add(fn);
}

/** Xoá cache theo phiên: react-query + mọi cache đã đăng ký. Dùng thay cho `queryClient.clear()` ở nơi đổi phiên. */
export function clearSessionCaches(): void {
  queryClient.clear();
  for (const fn of cleaners) {
    try {
      fn();
    } catch {
      /* một cache hỏng không được chặn đăng xuất */
    }
  }
}
