import { create } from 'zustand';

const KEY = 'tirapro-ai-enabled';

/** Đọc trạng thái bật/tắt AI từ localStorage (mặc định BẬT). */
function initial(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

function persist(v: boolean) {
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

interface AiState {
  /** Người dùng có muốn hiển thị các tính năng AI hỗ trợ hay không. */
  enabled: boolean;
  toggle: () => void;
  set: (v: boolean) => void;
}

/**
 * Bật/tắt trợ lý AI ở phía client. Khi tắt, mọi nút/panel AI hỗ trợ sẽ ẩn đi.
 * Đây là tuỳ chọn hiển thị của người dùng (không đổi cấu hình server).
 */
export const useAi = create<AiState>((set) => ({
  enabled: initial(),
  toggle: () =>
    set((s) => {
      const v = !s.enabled;
      persist(v);
      return { enabled: v };
    }),
  set: (v) => {
    persist(v);
    set({ enabled: v });
  },
}));
