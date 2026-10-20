/** Vị trí một ô trong lưới: dòng `r`, cột `c` (đếm từ 0, chỉ tính ô bấm được). */
export interface CellPos {
  r: number;
  c: number;
}

/**
 * Ô kế tiếp khi bấm phím điều hướng trong lưới ô (mô hình "roving tabindex": cả lưới chỉ MỘT điểm dừng Tab). Mũi tên kẹp ở
 * biên (không vòng); Home/End = đầu/cuối dòng, Ctrl+Home/End = ô đầu/cuối cả lưới. Phím khác → `null` (để Tab/Space/chữ
 * chạy như thường). Vị trí lệch biên (dòng vừa biến mất) được kẹp lại.
 */
export function nextCell(
  pos: CellPos,
  key: string,
  size: { rows: number; cols: number },
  ctrl: boolean,
): CellPos | null {
  const { rows, cols } = size;
  if (rows <= 0 || cols <= 0) return null;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
  const r = clamp(pos.r, rows);
  const c = clamp(pos.c, cols);
  switch (key) {
    case 'ArrowRight':
      return { r, c: clamp(c + 1, cols) };
    case 'ArrowLeft':
      return { r, c: clamp(c - 1, cols) };
    case 'ArrowDown':
      return { r: clamp(r + 1, rows), c };
    case 'ArrowUp':
      return { r: clamp(r - 1, rows), c };
    case 'Home':
      return ctrl ? { r: 0, c: 0 } : { r, c: 0 };
    case 'End':
      return ctrl ? { r: rows - 1, c: cols - 1 } : { r, c: cols - 1 };
    default:
      return null;
  }
}
