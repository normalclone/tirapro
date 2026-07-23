import { create } from 'zustand';

/** Các tác vụ nhanh có thể bật/tắt trên nút nổi. */
export type QuickActionKey = 'issue' | 'ai' | 'report' | 'watch' | 'project' | 'command';

export const QUICK_ACTION_KEYS: QuickActionKey[] = ['issue', 'ai', 'report', 'watch', 'project', 'command'];

const STORAGE = 'tirapro-quick-actions';

function initial(): Record<QuickActionKey, boolean> {
  const base = Object.fromEntries(QUICK_ACTION_KEYS.map((k) => [k, true])) as Record<QuickActionKey, boolean>;
  if (typeof localStorage === 'undefined') return base;
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) Object.assign(base, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return base;
}

interface QuickActionState {
  enabled: Record<QuickActionKey, boolean>;
  toggle: (key: QuickActionKey) => void;
}

/** Tuỳ biến danh sách tác vụ nhanh trên nút nổi (lưu localStorage, mặc định bật hết). */
export const useQuickActions = create<QuickActionState>((set) => ({
  enabled: initial(),
  toggle: (key) =>
    set((s) => {
      const enabled = { ...s.enabled, [key]: !s.enabled[key] };
      try {
        localStorage.setItem(STORAGE, JSON.stringify(enabled));
      } catch {
        /* ignore */
      }
      return { enabled };
    }),
}));
