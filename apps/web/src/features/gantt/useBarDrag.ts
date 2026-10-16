import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { pxToDays } from './dragMath';

export type BarDragMode = 'move' | 'start' | 'end';

interface BarDragPreview {
  id: string;
  mode: BarDragMode;
  deltaDays: number;
}

/** Kéo dưới ngưỡng này (px) coi là bấm chứ không phải kéo. */
const DRAG_THRESHOLD_PX = 3;

interface Options<T extends { id: string }> {
  dayW: number;
  /** Có cho kéo thanh của việc này không (quyền + lưu trữ). */
  canDrag: (item: T) => boolean;
  /** Kẹp số ngày để thanh không trượt ra ngoài thước thời gian. */
  clamp?: (item: T, mode: BarDragMode, deltaDays: number) => number;
  /** Thả (hoặc phím mũi tên) với `deltaDays` ≠ 0. */
  onCommit: (item: T, mode: BarDragMode, deltaDays: number) => void;
}

interface Active<T> {
  item: T;
  mode: BarDragMode;
  pointerId: number;
  startX: number;
  moved: boolean;
  /** Đã vẽ xem trước ít nhất một lần. */
  shown: boolean;
  delta: number;
}

/**
 * Kéo thanh Gantt bằng pointer events (không dnd-kit: cần trục ngày liên tục theo pixel).
 * Chỉ chuột/bút; cảm ứng giữ nguyên cuộn trang (đặt ngày ở trang công việc hoặc ngăn "Chưa lên lịch").
 * `preview` đổi theo NGÀY (không theo px) nên chỉ vẽ lại khi nhảy sang ngày khác.
 */
export function useBarDrag<T extends { id: string }>({
  dayW,
  canDrag,
  clamp,
  onCommit,
}: Options<T>) {
  const [preview, setPreview] = useState<BarDragPreview | null>(null);
  const active = useRef<Active<T> | null>(null);
  /** Vừa kéo xong → bỏ `click` kế tiếp (kẻo kéo xong lại mở công việc). */
  const suppressClick = useRef(false);

  const finish = useCallback(() => {
    active.current = null;
    setPreview(null);
  }, []);

  const bind = useCallback(
    (item: T, mode: BarDragMode) => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || e.pointerType === 'touch' || !canDrag(item)) return;
        if (mode !== 'move') e.stopPropagation(); // tay nắm mép không kích hoạt kéo thân
        suppressClick.current = false;
        active.current = {
          item,
          mode,
          pointerId: e.pointerId,
          startX: e.clientX,
          moved: false,
          shown: false,
          delta: 0,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const a = active.current;
        if (!a || a.pointerId !== e.pointerId || a.item.id !== item.id || a.mode !== mode) return;
        const dx = e.clientX - a.startX;
        if (!a.moved) {
          if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
          a.moved = true;
        }
        const raw = pxToDays(dx, dayW);
        const next = clamp ? clamp(item, mode, raw) : raw;
        if (next === a.delta && a.shown) return;
        a.shown = true;
        a.delta = next;
        setPreview({ id: item.id, mode, deltaDays: next });
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        const a = active.current;
        if (!a || a.pointerId !== e.pointerId || a.item.id !== item.id || a.mode !== mode) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (a.moved) suppressClick.current = true;
        const delta = a.delta;
        finish();
        if (a.moved && delta !== 0) onCommit(item, mode, delta);
      },
      onPointerCancel: () => {
        if (active.current) finish();
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === 'Escape' && active.current) {
          e.stopPropagation();
          suppressClick.current = true;
          finish();
          return;
        }
        if (mode !== 'move' || !canDrag(item)) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        // Shift = dời cả thanh ±1 ngày; Alt = đổi hạn ±1 ngày.
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey && !e.altKey) {
          e.preventDefault();
          const d = clamp ? clamp(item, 'move', dir) : dir;
          if (d !== 0) onCommit(item, 'move', d);
        } else if (e.altKey && !e.shiftKey) {
          e.preventDefault();
          const d = clamp ? clamp(item, 'end', dir) : dir;
          if (d !== 0) onCommit(item, 'end', d);
        }
      },
    }),
    [canDrag, clamp, dayW, finish, onCommit],
  );

  /** Gọi ở `onClick`: true = click này là đuôi của một cú kéo → bỏ qua. */
  const consumeClick = useCallback(() => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { preview, bind, consumeClick };
}
