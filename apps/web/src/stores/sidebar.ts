import { create } from 'zustand';

const KEY_PREFIX = 'tirapro-sidebar-collapsed:';

/** Khoá lưu theo TÀI KHOẢN (người dùng chung một trình duyệt không lẫn lựa chọn của nhau). */
export const sidebarKey = (userId: string | null | undefined): string =>
  `${KEY_PREFIX}${userId ?? 'anon'}`;

export function readCollapsed(userId: string | null | undefined): boolean {
  try {
    return localStorage.getItem(sidebarKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function writeCollapsed(userId: string | null | undefined, v: boolean): void {
  try {
    localStorage.setItem(sidebarKey(userId), v ? '1' : '0');
  } catch {
    /* trình duyệt chặn lưu trữ: chỉ mất khả năng nhớ, vẫn dùng được */
  }
}

interface SidebarState {
  collapsed: boolean;
  /** Nạp lựa chọn đã lưu của tài khoản (gọi khi biết người dùng / đổi tài khoản). */
  hydrate: (userId: string | null | undefined) => void;
  toggle: (userId: string | null | undefined) => void;
}

/** Thu gọn/mở rộng thanh điều hướng trái (chỉ từ `lg`; nhớ theo tài khoản trong localStorage). */
export const useSidebar = create<SidebarState>((set, get) => ({
  collapsed: false,
  hydrate: (userId) => set({ collapsed: readCollapsed(userId) }),
  toggle: (userId) => {
    const v = !get().collapsed;
    writeCollapsed(userId, v);
    set({ collapsed: v });
  },
}));
