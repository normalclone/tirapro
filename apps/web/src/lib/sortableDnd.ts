import {
  closestCenter,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core';

/** 120ms ease-out-quart — token `fast` của DESIGN.md (reduced-motion đã bị globals.css ép về ~0). */
export const SORT_TRANSITION = { duration: 120, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' } as const;

/**
 * Ưu tiên THẺ dưới con trỏ (nhỏ hơn container). Con trỏ nằm trong container nhưng không trúng thẻ nào (khe giữa thẻ,
 * mép dưới) → thẻ gần nhất của container đó, để thả ở khe không bị hiểu là "thả vào khoảng trống = xuống cuối".
 * Bàn phím không có toạ độ con trỏ → closestCorners (khuyến nghị của dnd-kit cho nhiều container).
 */
/** `data.current` của dnd-kit là `any` — chỉ đọc đúng hai trường cần, có kiểu. */
interface DroppableData {
  container?: unknown;
  sortable?: { containerId?: unknown };
}
const dataOf = (c: { data: { current?: unknown } }) => c.data.current as DroppableData | undefined;

export const sortableCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const first = within[0];
  if (!first) return closestCorners(args);
  const container = args.droppableContainers.find((c) => c.id === first.id);
  if (!container || !dataOf(container)?.container) return within;
  const rows = args.droppableContainers.filter(
    (c) => dataOf(c)?.sortable?.containerId === first.id,
  );
  return rows.length > 0 ? closestCenter({ ...args, droppableContainers: rows }) : within;
};
