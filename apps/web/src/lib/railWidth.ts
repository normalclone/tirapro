import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

/** Độ rộng danh sách dự án (px): mặc định = w-56 cũ; kéo được trong khoảng này để đọc tên dự án dài. */
export const RAIL_WIDTH_DEFAULT = 224;
export const RAIL_WIDTH_MIN = 200;
export const RAIL_WIDTH_MAX = 480;
/** Bước khi chỉnh bằng phím mũi tên (Shift = bước lớn). */
const RAIL_WIDTH_STEP = 16;
const RAIL_WIDTH_STEP_LARGE = 64;

export function railWidthKey(userId: string | undefined): string {
  return `tirapro:rail-width:${userId ?? 'anon'}`;
}

export function clampRailWidth(px: number): number {
  if (!Number.isFinite(px)) return RAIL_WIDTH_DEFAULT;
  return Math.round(Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, px)));
}

/** Giá trị đã lưu → độ rộng hợp lệ (rác/thiếu → mặc định). */
export function parseRailWidth(raw: string | null): number {
  if (raw === null || raw.trim() === '') return RAIL_WIDTH_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? clampRailWidth(n) : RAIL_WIDTH_DEFAULT;
}

/** Phím trên tay nắm kéo → độ rộng mới; `null` = phím không liên quan. */
export function railWidthForKey(current: number, key: string, shift: boolean): number | null {
  const step = shift ? RAIL_WIDTH_STEP_LARGE : RAIL_WIDTH_STEP;
  switch (key) {
    case 'ArrowRight':
      return clampRailWidth(current + step);
    case 'ArrowLeft':
      return clampRailWidth(current - step);
    case 'Home':
      return RAIL_WIDTH_MIN;
    case 'End':
      return RAIL_WIDTH_MAX;
    case 'Enter':
      return RAIL_WIDTH_DEFAULT;
    default:
      return null;
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* chế độ riêng tư / bị chặn: vẫn chạy, chỉ không nhớ */
  }
}

/**
 * Độ rộng danh sách dự án do người dùng kéo (nhớ theo người dùng trên trình duyệt này). Trả về props cho tay nắm:
 * kéo chuột/cảm ứng, phím mũi tên (Shift = bước lớn), Home/End = nhỏ/lớn nhất, Enter hoặc bấm đúp = về mặc định.
 */
export function useRailWidth(userId: string | undefined) {
  const key = railWidthKey(userId);
  const [width, setWidth] = useState(() => parseRailWidth(read(key)));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => setWidth(parseRailWidth(read(key))), [key]);

  const commit = useCallback(
    (px: number) => {
      const w = clampRailWidth(px);
      setWidth(w);
      write(key, w);
    },
    [key],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { startX: e.clientX, startW: width };
      setDragging(true);
    },
    [width],
  );
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (e.buttons === 0) return; // nhả chuột ở ngoài mà không nhận được pointerup
    setWidth(clampRailWidth(d.startW + e.clientX - d.startX));
  }, []);
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      setDragging(false);
      commit(d.startW + e.clientX - d.startX);
    },
    [commit],
  );
  /** Huỷ kéo (pointercancel / mất capture / rail bị thu giữa chừng): trả về độ rộng lúc bắt đầu, không lưu. */
  const cancelDrag = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    setWidth(d.startW);
  }, []);
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const next = railWidthForKey(width, e.key, e.shiftKey);
      if (next === null) return;
      e.preventDefault();
      commit(next);
    },
    [width, commit],
  );
  const onDoubleClick = useCallback(() => commit(RAIL_WIDTH_DEFAULT), [commit]);

  return {
    width,
    dragging,
    cancelDrag,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancelDrag,
      onLostPointerCapture: onPointerUp,
      onKeyDown,
      onDoubleClick,
    },
  };
}
