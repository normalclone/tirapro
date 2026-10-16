import { useSyncExternalStore } from 'react';

/**
 * Loại việc ô thêm nhanh đang nhớ (mã `typeRef`: khoá loại hoặc `name:<tên>` cho loại tuỳ chỉnh, không phải id → dùng được giữa dự án). Một nguồn dùng chung cho mọi ô
 * đang mount (mỗi cột Board / khu Việc chờ) để đổi ở một nơi thì nơi khác đổi theo; lưu `localStorage` để nhớ giữa các lần mở.
 */
export const QUICK_ADD_TYPE_KEY = 'tirapro:quickAddTypeKey';

const listeners = new Set<() => void>();
let current: string | null | undefined; // undefined = chưa đọc từ localStorage

export function getQuickAddTypeKey(): string | null {
  if (current === undefined) {
    try {
      current = localStorage.getItem(QUICK_ADD_TYPE_KEY);
    } catch {
      current = null; // chế độ riêng tư / bị chặn lưu trữ: vẫn nhớ trong phiên
    }
  }
  return current;
}

export function setQuickAddTypeKey(key: string | null) {
  current = key;
  try {
    if (key) localStorage.setItem(QUICK_ADD_TYPE_KEY, key);
    else localStorage.removeItem(QUICK_ADD_TYPE_KEY);
  } catch {
    /* bỏ qua */
  }
  for (const l of listeners) l();
}

export function subscribeQuickAddType(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function useQuickAddTypeKey(): string | null {
  return useSyncExternalStore(subscribeQuickAddType, getQuickAddTypeKey, () => null);
}
