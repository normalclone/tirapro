import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { keyToDrag, pxToDays, type DragMode } from './dragMath';

export type BarDragMode = DragMode;

interface BarDragPreview {
  id: string;
  mode: BarDragMode;
  deltaDays: number;
}

/** Kéo dưới ngưỡng này (px) coi là bấm chứ không phải kéo. */
const DRAG_THRESHOLD_PX = 3;
/** Giữ/bấm liên tiếp phím mũi tên: gộp thành MỘT lần ghi sau khoảng lặng này. */
const KEY_COMMIT_MS = 350;

interface Options<T extends { id: string }> {
  dayW: number;
  /** Có cho kéo thanh của việc này không (quyền + lưu trữ). */
  canDrag: (item: T) => boolean;
  /** Kẹp số ngày để thanh không trượt ra ngoài thước thời gian. */
  clamp?: (item: T, mode: BarDragMode, deltaDays: number) => number;
  /** Thả (hoặc xong một chuỗi phím mũi tên) với `deltaDays` ≠ 0. */
  onCommit: (item: T, mode: BarDragMode, deltaDays: number) => void;
}

interface Active<T> {
  /** Phần tử đang tắt tooltip (nút thanh — nơi nhận focus khi nhấn). */
  tipEl: HTMLElement;
  /** Phần tử giữ pointer capture. */
  captureEl: HTMLElement;
  item: T;
  mode: BarDragMode;
  pointerId: number;
  startX: number;
  moved: boolean;
  /** Đã vẽ xem trước ít nhất một lần. */
  shown: boolean;
  delta: number;
}

interface KeyAcc<T> {
  item: T;
  mode: BarDragMode;
  delta: number;
}

/**
 * Kéo thanh Gantt bằng pointer events (không dnd-kit: cần trục ngày liên tục theo pixel).
 * Chỉ chuột/bút; cảm ứng giữ nguyên cuộn trang (đặt ngày ở trang công việc hoặc ngăn "Chưa lên lịch").
 * `preview` đổi theo NGÀY (không theo px) nên chỉ vẽ lại khi nhảy sang ngày khác.
 * Phím mũi tên (xem `keyToDrag`) cộng dồn rồi ghi MỘT lần khi ngừng bấm (hoặc mất focus) — một PATCH, một toast.
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
  const keyAcc = useRef<KeyAcc<T> | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout>>();
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  /** Esc ở BẤT KỲ đâu trong lúc kéo (focus có thể không ở nút — Safari/Firefox macOS không focus button khi bấm). */
  const onWindowKey = useRef<(e: globalThis.KeyboardEvent) => void>();

  const finish = useCallback(() => {
    const a = active.current;
    if (a) {
      // Trả lại tooltip (đã tắt suốt cú kéo — xem onPointerDown).
      a.tipEl.removeAttribute('data-no-tip');
      if (onWindowKey.current) window.removeEventListener('keydown', onWindowKey.current, true);
      onWindowKey.current = undefined;
    }
    active.current = null;
    setPreview(null);
  }, []);

  const flushKeys = useCallback(() => {
    clearTimeout(keyTimer.current);
    const k = keyAcc.current;
    keyAcc.current = null;
    setPreview(null);
    if (k && k.delta !== 0) onCommitRef.current(k.item, k.mode, k.delta);
  }, []);

  // Rời trang khi còn chuỗi phím chưa ghi → ghi nốt (không mất thao tác người dùng đã thấy trên màn hình).
  useEffect(() => flushKeys, [flushKeys]);

  const queueKey = useCallback(
    (item: T, mode: BarDragMode, dir: 1 | -1) => {
      let k = keyAcc.current;
      if (k && (k.item.id !== item.id || k.mode !== mode)) {
        flushKeys();
        k = null;
      }
      const cur = k?.delta ?? 0;
      const next = clamp ? clamp(item, mode, cur + dir) : cur + dir;
      if (next === cur) return; // chạm đầu/cuối thước
      keyAcc.current = { item: k?.item ?? item, mode, delta: next };
      setPreview({ id: item.id, mode, deltaDays: next });
      clearTimeout(keyTimer.current);
      keyTimer.current = setTimeout(flushKeys, KEY_COMMIT_MS);
    },
    [clamp, flushKeys],
  );

  const bind = useCallback(
    (item: T, mode: BarDragMode) => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || e.pointerType === 'touch' || !canDrag(item)) return;
        if (mode !== 'move') e.stopPropagation(); // tay nắm mép không kích hoạt kéo thân
        suppressClick.current = false;
        flushKeys();
        // Nhấn xuống làm NÚT THANH nhận focus (kể cả khi bấm tay nắm con) → InstantTooltip bật tooltip che thanh
        // đang kéo: tắt trên nút đó cho tới khi nhả.
        const tipEl = e.currentTarget.closest<HTMLElement>('button') ?? e.currentTarget;
        tipEl.setAttribute('data-no-tip', '');
        const a: Active<T> = {
          tipEl,
          captureEl: e.currentTarget,
          item,
          mode,
          pointerId: e.pointerId,
          startX: e.clientX,
          moved: false,
          shown: false,
          delta: 0,
        };
        active.current = a;
        e.currentTarget.setPointerCapture(e.pointerId);
        const onKey = (ev: globalThis.KeyboardEvent) => {
          if (ev.key !== 'Escape' || active.current !== a) return;
          ev.stopPropagation();
          if (a.captureEl.hasPointerCapture(a.pointerId))
            a.captureEl.releasePointerCapture(a.pointerId);
          suppressClick.current = true;
          finish();
        };
        onWindowKey.current = onKey;
        window.addEventListener('keydown', onKey, true);
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
      onBlur: flushKeys,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (mode !== 'move' || !canDrag(item)) return;
        const kd = keyToDrag(e);
        if (!kd) return;
        e.preventDefault();
        queueKey(item, kd.mode, kd.dir);
      },
    }),
    [canDrag, clamp, dayW, finish, flushKeys, onCommit, queueKey],
  );

  /** Gọi ở `onClick`: true = click này là đuôi của một cú kéo → bỏ qua. */
  const consumeClick = useCallback(() => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { preview, bind, consumeClick };
}
