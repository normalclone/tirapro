import { useCallback, useEffect, useRef, useState } from 'react';
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

/** Bấm "Nhóm theo người": đang theo người → về mặc định của bảng (hoặc `none` nếu mặc định cũng là người); ngược lại → theo người. */
export function toggleAssigneeSwimlane(
  boardBy: SwimlaneBy,
  override: SwimlaneOverride,
): SwimlaneOverride {
  const next: SwimlaneBy =
    effectiveSwimlane(boardBy, override) === 'assignee'
      ? boardBy === 'assignee'
        ? 'none'
        : boardBy
      : 'assignee';
  return next === boardBy ? null : next;
}

/** Cách chia hàng hiệu lực = sở thích cá nhân (localStorage, theo người + theo bảng) nếu có, không thì cấu hình bảng. */
export function useSwimlaneOverride(boardId: string | undefined, boardBy: SwimlaneBy) {
  const userId = useAuth((s) => s.user?.id);
  const [override, setOverride] = useState<SwimlaneOverride>(null);
  const ref = useRef<SwimlaneOverride>(null);
  const storageKey = userId && boardId ? swimlaneStorageKey(userId, boardId) : null;

  useEffect(() => {
    let v: SwimlaneOverride = null;
    try {
      if (storageKey) v = parseSwimlaneOverride(localStorage.getItem(storageKey));
    } catch {
      /* bị chặn */
    }
    ref.current = v;
    setOverride(v);
  }, [storageKey]);

  const toggleAssignee = useCallback(() => {
    const next = toggleAssigneeSwimlane(boardBy, ref.current);
    ref.current = next;
    setOverride(next);
    try {
      if (!storageKey) return;
      if (next === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, next);
    } catch {
      /* bị chặn */
    }
  }, [boardBy, storageKey]);

  return { swimlaneBy: effectiveSwimlane(boardBy, override), override, toggleAssignee };
}
