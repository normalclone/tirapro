import {
  closestCenter,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { EPIC_DROP_PREFIX } from './epic';

/** 120ms ease-out-quart — token `fast` của DESIGN.md (reduced-motion đã bị globals.css ép về ~0). */
export const SORT_TRANSITION = { duration: 120, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' } as const;

/** `data.current` của dnd-kit là `any` — chỉ đọc đúng hai trường cần, có kiểu. */
interface DroppableData {
  container?: unknown;
  sortable?: { containerId?: string | number };
}
const dataOf = (c: { data: { current?: unknown } }) => c.data.current as DroppableData | undefined;

/**
 * Ưu tiên THẺ dưới con trỏ (nhỏ hơn container). Con trỏ nằm trong container nhưng không trúng thẻ nào (khe giữa thẻ,
 * mép dưới) → thẻ gần nhất của container đó, để thả ở khe không bị hiểu là "thả vào khoảng trống = xuống cuối".
 * Bàn phím không có toạ độ con trỏ → closestCorners (khuyến nghị của dnd-kit cho nhiều container).
 * Kéo CHUỘT mà con trỏ nằm ngoài mọi cột/thẻ (toolbar, lề, khe giữa cột) → không có đích (`[]`, over = null) để thả ra
 * ngoài là huỷ, không bị hút vào cột/thẻ gần nhất.
 */
export const sortableCollision: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCorners(args);
  const within = pointerWithin(args);
  const first = within[0];
  if (!first) return [];
  const container = args.droppableContainers.find((c) => c.id === first.id);
  if (!container || !dataOf(container)?.container) return within;
  const rows = args.droppableContainers.filter(
    (c) => dataOf(c)?.sortable?.containerId === first.id,
  );
  return rows.length > 0 ? closestCenter({ ...args, droppableContainers: rows }) : within;
};

const isEpicTarget = (c: { id: string | number }) => String(c.id).startsWith(EPIC_DROP_PREFIX);

/** Vùng kéo (bàn phím) đã sang bề ngang của panel Epic — cạnh trái nằm trước mép phải của một mục epic. */
export function overlapsEpicPanel(
  rect: { left: number } | null | undefined,
  epicRects: { right: number }[],
): boolean {
  return !!rect && epicRects.some((r) => rect.left < r.right);
}

/**
 * Như `sortableCollision` nhưng với BÀN PHÍM các mục panel Epic chỉ được xét khi vùng kéo đã sang panel
 * (người dùng chủ động bấm ←), để mũi tên lên/xuống sát mép danh sách không rơi nhầm vào epic rồi Space ghi dữ liệu.
 * Kéo chuột: không đổi (con trỏ phải thật sự nằm trong mục epic mới trúng).
 */
export const epicAwareCollision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) return sortableCollision(args);
  const epicRects = args.droppableContainers
    .filter(isEpicTarget)
    .flatMap((c) => args.droppableRects.get(c.id) ?? []);
  if (overlapsEpicPanel(args.collisionRect, epicRects)) return closestCorners(args);
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => !isEpicTarget(c)),
  });
};

/**
 * `sortableKeyboardCoordinates` nhưng không đưa mục epic vào ứng viên trừ khi người dùng bấm ← hoặc vùng kéo đang ở panel
 * (mũi tên lên/xuống từ danh sách không "nhảy" sang epic vì epic nằm cao hơn/thấp hơn).
 */
export const epicAwareKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { context } = args;
  const all = context.droppableContainers.getEnabled();
  const epicRects = all.filter(isEpicTarget).flatMap((c) => context.droppableRects.get(c.id) ?? []);
  if (event.code === 'ArrowLeft' || overlapsEpicPanel(context.collisionRect, epicRects))
    return sortableKeyboardCoordinates(event, args);
  const kept = all.filter((c) => !isEpicTarget(c));
  const droppableContainers = {
    ...context.droppableContainers,
    getEnabled: () => kept,
    get: (id: string | number) => context.droppableContainers.get(id),
  } as unknown as typeof context.droppableContainers;
  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...context, droppableContainers },
  });
};
