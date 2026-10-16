export interface Ranked {
  id: string;
  rank: string;
}

/** Cùng thứ tự máy chủ (`ORDER BY rank ASC, id ASC`). */
export function byRank(a: Ranked, b: Ranked): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const sortByRank = <T extends Ranked>(list: readonly T[]): T[] => [...list].sort(byRank);

/** Một lần kéo đang chờ máy chủ: đúng hai mốc đã gửi cho API. */
export interface PendingMove {
  id: string;
  afterId: string | null;
  beforeId: string | null;
}

/**
 * Thứ tự lạc quan KHÔNG tự tính rank: đặt mỗi việc đang chờ ngay sau `afterId` (hoặc ngay trước `beforeId`).
 * `list` đã sắp theo rank; trả mảng mới. Việc/mốc không có trong `list` (thuộc container khác, đã lọc) thì bỏ qua.
 */
export function applyPendingOrder<T extends { id: string }>(
  list: T[],
  pending: readonly PendingMove[],
): T[] {
  let out = list;
  for (const p of pending) {
    const from = out.findIndex((i) => i.id === p.id);
    if (from < 0) continue;
    const rest = out.filter((_, idx) => idx !== from);
    const after = p.afterId ? rest.findIndex((i) => i.id === p.afterId) : -1;
    const before = p.beforeId ? rest.findIndex((i) => i.id === p.beforeId) : -1;
    const at = after >= 0 ? after + 1 : before >= 0 ? before : -1;
    if (at < 0) continue;
    out = [...rest.slice(0, at), out[from]!, ...rest.slice(at)];
  }
  return out;
}
