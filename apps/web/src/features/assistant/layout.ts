import type { CSSProperties } from 'react';
import { BOTTOM_BAR_PX } from '@/lib/bottomBar';

/**
 * Tính vị trí cửa sổ chat dưới `lg` (thuần, test được). Bàn phím ảo phủ lên layout viewport (iOS Safari, Chrome Android):
 * `visualViewport` cho biết phần còn nhìn thấy → cửa sổ neo TRÊN bàn phím để ô nhập luôn thấy.
 */

/** Dưới ngưỡng này coi là thanh địa chỉ co giãn, không phải bàn phím. */
const KEYBOARD_MIN_PX = 120;

/** Chiều cao bàn phím ảo (px) suy từ visualViewport; 0 = không có bàn phím. */
export function keyboardInset(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  const inset = Math.round(innerHeight - vvHeight - vvOffsetTop);
  return inset >= KEYBOARD_MIN_PX ? inset : 0;
}

const ABOVE_BAR = `calc(${BOTTOM_BAR_PX}px + env(safe-area-inset-bottom) + 8px)`;

/**
 * Cửa sổ dưới `lg`: luôn neo PHẢI (mọi bề rộng — từ `sm` rộng 360px thì nằm sát phải, không dính trái); mở rộng thì kéo
 * từ đỉnh tới trên thanh tab (hoặc trên bàn phím khi có), thu nhỏ thì chỉ neo đáy.
 */
export function mobileWindowStyle(o: {
  minimized: boolean;
  inset: number;
  offsetTop: number;
}): CSSProperties {
  const bottom = o.inset > 0 ? o.inset + 8 : ABOVE_BAR;
  return o.minimized
    ? { bottom, right: 8 }
    : { bottom, right: 8, top: 8 + Math.round(o.offsetTop) };
}

/** Có cần kéo focus về ô nhập không: focus đang ở body/ngoài cửa sổ (vd Radix của Cmd+K vừa trả focus về trang). */
export function shouldRefocus(
  active: Element | null,
  body: Element,
  win: { contains(n: Node): boolean } | null,
): boolean {
  if (!win) return false;
  return !active || active === body || !win.contains(active);
}
