/** Vị trí một ô trong lưới: dòng `r`, cột `c` (đếm từ 0, chỉ tính ô bấm được). */
export interface CellPos {
  r: number;
  c: number;
}

/** Phím bổ trợ đang giữ. */
export interface NavMods {
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
  shift?: boolean;
}

const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));

/** Kẹp vị trí vào lưới `size` (lưới co lại: dòng/cột cuối biến mất). Lưới rỗng → {0,0}. */
export function clampCell(pos: CellPos, size: { rows: number; cols: number }): CellPos {
  return { r: clamp(pos.r, size.rows), c: clamp(pos.c, size.cols) };
}

/**
 * Ô (r, c) có phải điểm dừng Tab (tabIndex 0) không? Vị trí `active` được KẸP theo kích thước lưới HIỆN TẠI lúc vẽ — nếu không,
 * khi dòng/cột đang chọn biến mất (gộp nhóm, đổi phạm vi, bỏ cột, "Chỉ hiện khác biệt") thì không ô nào có tabIndex 0 và
 * lưới mất lối vào bằng bàn phím.
 */
export function isTabStop(
  active: CellPos,
  size: { rows: number; cols: number },
  r: number,
  c: number,
): boolean {
  const a = clampCell(active, size);
  return a.r === r && a.c === c;
}

/**
 * Ô kế tiếp khi bấm phím điều hướng trong lưới ô (mô hình "roving tabindex": cả lưới chỉ MỘT điểm dừng Tab). Mũi tên kẹp ở
 * biên (không vòng); Home/End = đầu/cuối dòng, Ctrl+Home/End = ô đầu/cuối cả lưới. Phím khác → `null` (để Tab/Space/chữ
 * chạy như thường). Không nuốt phím tắt của trình duyệt: Alt/Meta + phím (lùi/tiến…) → null; mũi tên kèm Ctrl/Shift → null;
 * Shift + Home/End vẫn chạy như Home/End.
 */
export function nextCell(
  pos: CellPos,
  key: string,
  size: { rows: number; cols: number },
  mods: NavMods = {},
): CellPos | null {
  const { rows, cols } = size;
  if (rows <= 0 || cols <= 0) return null;
  if (mods.alt || mods.meta) return null;
  const { r, c } = clampCell(pos, size);
  const plain = !mods.ctrl && !mods.shift;
  switch (key) {
    case 'ArrowRight':
      return plain ? { r, c: clamp(c + 1, cols) } : null;
    case 'ArrowLeft':
      return plain ? { r, c: clamp(c - 1, cols) } : null;
    case 'ArrowDown':
      return plain ? { r: clamp(r + 1, rows), c } : null;
    case 'ArrowUp':
      return plain ? { r: clamp(r - 1, rows), c } : null;
    case 'Home':
      return mods.ctrl ? { r: 0, c: 0 } : { r, c: 0 };
    case 'End':
      return mods.ctrl ? { r: rows - 1, c: cols - 1 } : { r, c: cols - 1 };
    default:
      return null;
  }
}
