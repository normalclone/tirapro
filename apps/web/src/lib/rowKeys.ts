/** Phím mà một dòng/thẻ dùng cho chính nó: Enter = xem nhanh, Space = nhấc thẻ (dnd), mũi tên = dời thẻ/focus. */
const ROW_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export const isRowKey = (key: string): boolean => ROW_KEYS.has(key);

/**
 * Cho một điều khiển lồng trong dòng/thẻ (ô chọn, nút "…", nội dung menu): chỉ chặn phím mà DÒNG/THẺ sẽ hiểu, để chúng không
 * kích hoạt hành vi của dòng. KHÔNG được chặn phím khác: `stopPropagation` của React dừng cả sự kiện gốc ở root nên mọi
 * handler ở `window`/`document` (phím tắt toàn cục `?`/g-chord/`c`, Cmd/Ctrl+K, j/k của xem nhanh, Esc bỏ chọn) sẽ chết.
 */
export function stopRowKeys(e: { key: string; stopPropagation: () => void }): void {
  if (isRowKey(e.key)) e.stopPropagation();
}
