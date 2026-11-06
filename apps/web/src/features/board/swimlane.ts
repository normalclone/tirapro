import { useCallback, useSyncExternalStore } from 'react';
import { SWIMLANE_BY, type SwimlaneBy } from '@tirapro/types';
import { useAuth } from '@/stores/auth';

/** `null` = theo cấu hình của bảng. */
export type SwimlaneOverride = SwimlaneBy | null;

export const swimlaneStorageKey = (userId: string, boardId: string) =>
  `tirapro:swimlane:${userId}:${boardId}`;

export function parseSwimlaneOverride(raw: string | null): SwimlaneOverride {
  return raw !== null && (SWIMLANE_BY as readonly string[]).includes(raw)
    ? (raw as SwimlaneBy)
    : null;
}

export const effectiveSwimlane = (boardBy: SwimlaneBy, override: SwimlaneOverride): SwimlaneBy =>
  override ?? boardBy;

/**
 * Bấm nút "Nhóm theo <kind>" (người / team): đang theo đúng kiểu đó → về mặc định của bảng (hoặc `none` nếu mặc định cũng là kiểu đó);
 * ngược lại → theo kiểu đó. Kết quả trùng cấu hình bảng thì trả `null` (không lưu sở thích riêng).
 */
export function toggleSwimlane(
  boardBy: SwimlaneBy,
  override: SwimlaneOverride,
  kind: 'assignee' | 'team',
): SwimlaneOverride {
  const next: SwimlaneBy =
    effectiveSwimlane(boardBy, override) === kind ? (boardBy === kind ? 'none' : boardBy) : kind;
  return next === boardBy ? null : next;
}

/** Phần tối thiểu của `Storage` mà module dùng (để test bằng Map). */
export type SwimlaneStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): SwimlaneStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // truy cập localStorage cũng có thể ném (chế độ riêng tư, chặn dữ liệu)
  }
}

/** Chuỗi thô trong storage (hoặc `null`); mọi lỗi storage → `null`. */
function readRaw(key: string | null, storage: SwimlaneStorage | null): string | null {
  if (!key || !storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Sai/thiếu → null; trùng cấu hình bảng hiện tại → null (để admin đổi cấu hình bảng về sau vẫn có hiệu lực). */
function normalizeSwimlaneOverride(raw: string | null, boardBy: SwimlaneBy): SwimlaneOverride {
  const v = parseSwimlaneOverride(raw);
  // Nút "Nhóm theo người" đã bỏ (người dùng yêu cầu 2026-11-06): sở thích riêng cũ theo người không còn cách tắt → bỏ qua.
  if (v === 'assignee') return null;
  return v === boardBy ? null : v;
}

export function readSwimlaneOverride(
  key: string | null,
  boardBy: SwimlaneBy,
  storage: SwimlaneStorage | null = defaultStorage(),
): SwimlaneOverride {
  return normalizeSwimlaneOverride(readRaw(key, storage), boardBy);
}

const listeners = new Set<() => void>();

/** `null` = xoá khoá. Báo cho các hook đang nghe (cùng tab) sau khi ghi. */
export function writeSwimlaneOverride(
  key: string,
  value: SwimlaneOverride,
  storage: SwimlaneStorage | null = defaultStorage(),
): void {
  try {
    if (storage) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
  } catch {
    /* bị chặn */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb); // tab khác đổi cùng khoá
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

/**
 * Cách chia hàng hiệu lực = sở thích cá nhân (localStorage, theo người + theo bảng) nếu có, không thì cấu hình bảng.
 * Đọc ĐỒNG BỘ qua `useSyncExternalStore`: khung hình đầu đã đúng bố cục, đổi bảng/người dùng không dùng nhầm khoá cũ.
 */
export function useSwimlaneOverride(boardId: string | undefined, boardBy: SwimlaneBy) {
  const userId = useAuth((s) => s.user?.id);
  const storageKey = userId && boardId ? swimlaneStorageKey(userId, boardId) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storageKey, defaultStorage()),
    () => null,
  );
  const override = normalizeSwimlaneOverride(raw, boardBy);

  const toggle = useCallback(
    (kind: 'assignee' | 'team') => {
      if (!storageKey) return;
      // Đọc lại từ storage lúc bấm (không dựa vào closure) để luôn khớp với tab khác.
      const next = toggleSwimlane(boardBy, readSwimlaneOverride(storageKey, boardBy), kind);
      writeSwimlaneOverride(storageKey, next);
    },
    [boardBy, storageKey],
  );
  const toggleTeam = useCallback(() => toggle('team'), [toggle]);

  return {
    swimlaneBy: effectiveSwimlane(boardBy, override),
    override,
    toggleTeam,
  };
}
