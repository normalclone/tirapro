import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/stores/auth';
import {
  DEFAULT_CARD_DISPLAY,
  cardDisplayKey,
  isDefaultDisplay,
  parseCardDisplay,
  readCardDisplayRaw,
  serializeCardDisplay,
  writeCardDisplay,
  type CardDisplay,
} from './cardDisplay';

const listeners = new Set<() => void>();
/**
 * Lựa chọn trong phiên: giữ hiệu lực khi storage bị chặn (ghi ném lỗi) — người dùng vẫn thấy bảng đổi ngay.
 * Một khoá bị `storage` event của tab khác đổi thì bỏ mục trong phiên để theo storage.
 */
const session = new Map<string, string | null>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key) session.delete(e.key);
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

const snapshotOf = (key: string | null): string | null => {
  if (!key) return null;
  return session.has(key) ? (session.get(key) ?? null) : readCardDisplayRaw(key);
};

/**
 * Tuỳ chọn hiển thị thẻ của người dùng hiện tại trên bảng `boardId` (localStorage theo người + bảng).
 * Đọc ĐỒNG BỘ qua `useSyncExternalStore` (khung hình đầu đã đúng; đổi bảng/người không dùng nhầm khoá cũ). `display` chỉ đổi
 * tham chiếu khi chuỗi lưu đổi, và bằng mặc định thì là đúng `DEFAULT_CARD_DISPLAY` → an toàn làm giá trị context.
 */
export function useCardDisplay(boardId: string | undefined) {
  const userId = useAuth((s) => s.user?.id);
  const key = userId && boardId ? cardDisplayKey(userId, boardId) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => snapshotOf(key),
    () => null,
  );
  const display = useMemo(() => parseCardDisplay(raw), [raw]);

  const update = useCallback(
    (next: CardDisplay) => {
      if (!key) return;
      session.set(key, serializeCardDisplay(next));
      writeCardDisplay(key, next);
      listeners.forEach((l) => l());
    },
    [key],
  );
  const reset = useCallback(() => update(DEFAULT_CARD_DISPLAY), [update]);

  return { display, update, reset, isDefault: isDefaultDisplay(display), enabled: key !== null };
}
