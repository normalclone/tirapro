/**
 * Thẻ (Board) / dòng (Việc chờ, Việc mới vào) đang được xem nhanh: nền + vòng bằng token — KHÔNG viền một bên (DESIGN.md cấm
 * side-stripe). Cùng một kiểu cho mọi danh sách để người dùng nhận ra "việc ở panel" ở đâu cũng giống nhau.
 */
export const PEEKED_ROW_CLS = 'bg-primary-subtle/60 ring-1 ring-primary/40';

/** `aria-current` cho phần tử đang xem (trình đọc màn hình biết đâu là việc đang mở ở panel); không xem → không thuộc tính. */
export function peekedAttrs(peeked: boolean | undefined): { 'aria-current'?: 'true' } {
  return peeked ? { 'aria-current': 'true' } : {};
}
