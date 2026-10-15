import type { Placement } from '@/lib/rankDrop';

/** Thả một dòng backlog: bỏ qua nếu không có gì đổi; ngược lại cho biết sprint đích (null = Backlog) và có đổi sprint không. */
export function planBacklogDrop(
  issue: { sprintId: string | null },
  p: Placement,
  backlogId: string,
): { ignore: true } | { ignore: false; targetSprintId: string | null; sprintChanged: boolean } {
  const targetSprintId = p.containerId === backlogId ? null : p.containerId;
  const sprintChanged = (issue.sprintId ?? null) !== targetSprintId;
  if (!sprintChanged && p.unchanged) return { ignore: true };
  return { ignore: false, targetSprintId, sprintChanged };
}

export interface Neighbors {
  afterId: string | null;
  beforeId: string | null;
}

/** Láng giềng thật của `id` trong `list` (không lọc) — dùng cho Hoàn tác để về đúng chỗ cũ, kể cả khi quanh đó có việc bị ẩn. */
export function neighborsIn(list: readonly string[], id: string): Neighbors {
  const i = list.indexOf(id);
  if (i < 0) return { afterId: null, beforeId: null };
  return { afterId: list[i - 1] ?? null, beforeId: list[i + 1] ?? null };
}

/**
 * Mốc tính trên danh sách ĐANG HIỂN THỊ (đã lọc) nên có thể thiếu một đầu dù giữa đó còn việc bị ẩn; server đặt rank ở TRUNG ĐIỂM
 * của khoảng trống nên việc rơi tuỳ ý trong khối việc ẩn. Mở rộng theo danh sách CHƯA lọc của khu đích (`full`, đã sắp rank) để việc
 * nằm SÁT mốc đang thấy: thiếu `afterId` → phần tử ngay trước `beforeId`; thiếu `beforeId` → phần tử ngay sau `afterId`;
 * đủ cả hai mà giữa có việc ẩn → `beforeId` thu về phần tử ngay sau `afterId`; cả hai thiếu mà khu đích có việc (bị lọc hết) → cuối khu. Bỏ chính dòng đang kéo. Mốc không có trong `full` thì giữ nguyên.
 */
export function widenNeighbors(full: readonly string[], n: Neighbors, activeId: string): Neighbors {
  const list = full.filter((id) => id !== activeId);
  if (!n.afterId && !n.beforeId) return { afterId: list.at(-1) ?? null, beforeId: null };
  if (!n.afterId) {
    const i = list.indexOf(n.beforeId!);
    return { afterId: i > 0 ? list[i - 1]! : null, beforeId: n.beforeId };
  }
  if (!n.beforeId) {
    const i = list.indexOf(n.afterId);
    return { afterId: n.afterId, beforeId: i >= 0 ? (list[i + 1] ?? null) : null };
  }
  // Cả hai mốc đều thấy: nếu giữa chúng còn việc ẩn thì thu hẹp `beforeId` về phần tử ngay sau `afterId`, để việc thả nằm SÁT mốc trên.
  const ai = list.indexOf(n.afterId);
  const bi = list.indexOf(n.beforeId);
  if (ai >= 0 && bi > ai + 1) return { afterId: n.afterId, beforeId: list[ai + 1]! };
  return n;
}
