/**
 * Phần tử ĐANG HIỂN THỊ đầu tiên trong danh sách (`display:none` ở chính nó hoặc tổ tiên → không có client rect).
 * Dùng cho tour: cùng một `data-tour` có thể nằm ở hai nơi (thanh bên desktop + thanh tab đáy mobile), chỉ một nơi hiện.
 */
export function firstVisible(nodes: ArrayLike<Element>): Element | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.getClientRects().length > 0) return n;
  }
  return null;
}
