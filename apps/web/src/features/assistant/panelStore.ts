import { create } from 'zustand';

const SEEN_KEY = 'tirapro:assistant:seen';
const readSeen = (): boolean => {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Trạng thái ô chat nổi của Trợ lý — TOÀN CỤC (không gắn route) nên mở/thu nhỏ giữ nguyên khi chuyển trang.
 * `open` = cửa sổ chat đang hiện; `minimized` = chỉ còn thanh tiêu đề; `seen` = đã mở lần nào trong phiên
 * (chưa thì bong bóng có chấm báo "có gợi ý").
 */
interface AssistantPanelState {
  open: boolean;
  minimized: boolean;
  seen: boolean;
  /** Mở (và bung ra nếu đang thu nhỏ) hoặc đóng hẳn về bong bóng. */
  setOpen: (open: boolean) => void;
  setMinimized: (minimized: boolean) => void;
}

export const useAssistantPanel = create<AssistantPanelState>((set) => ({
  open: false,
  minimized: false,
  seen: readSeen(),
  setOpen: (open) =>
    set((s) => {
      if (open && !s.seen) {
        try {
          sessionStorage.setItem(SEEN_KEY, '1');
        } catch {
          /* storage bị chặn */
        }
      }
      return { open, minimized: false, seen: s.seen || open };
    }),
  setMinimized: (minimized) => set({ minimized }),
}));

/** Khu quản trị hệ thống (`/admin…`): Trợ lý ẩn ở đó (gắn với không gian làm việc, giống nút trợ lý AI). */
export const isAdminPath = (pathname: string): boolean =>
  pathname === '/admin' || pathname.startsWith('/admin/');
