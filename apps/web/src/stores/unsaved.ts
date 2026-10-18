import { create } from 'zustand';

/** Một form đang "sửa rồi Lưu" đăng ký vào thanh "thay đổi chưa lưu" dùng chung. */
export interface UnsavedEntry {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  save: () => void | Promise<unknown>;
  reset: () => void;
}

interface UnsavedState {
  entries: Record<string, UnsavedEntry>;
  set: (id: string, e: UnsavedEntry) => void;
  remove: (id: string) => void;
}

export const useUnsavedStore = create<UnsavedState>((set) => ({
  entries: {},
  set: (id, e) => set((s) => ({ entries: { ...s.entries, [id]: e } })),
  remove: (id) =>
    set((s) => {
      if (!(id in s.entries)) return s;
      const { [id]: _gone, ...rest } = s.entries;
      return { entries: rest };
    }),
}));

/** Thuần — các mục đang có thay đổi chưa lưu. */
export function dirtyEntries(entries: Record<string, UnsavedEntry>): [string, UnsavedEntry][] {
  return Object.entries(entries).filter(([, e]) => e.dirty);
}

/** Thuần — số liệu cho thanh: `canSave` = VÀ, `saving` = HOẶC trên các mục dirty. */
export function summarizeDirty(entries: Record<string, UnsavedEntry>): {
  count: number;
  canSave: boolean;
  saving: boolean;
} {
  const dirty = dirtyEntries(entries);
  return {
    count: dirty.length,
    canSave: dirty.every(([, e]) => e.canSave),
    saving: dirty.some(([, e]) => e.saving),
  };
}
