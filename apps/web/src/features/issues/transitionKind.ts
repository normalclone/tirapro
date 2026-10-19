export type TransitionKind = 'close' | 'reopen' | 'return' | 'forward';

/**
 * Loại bước chuyển trạng thái — quyết định có hỏi thêm hay không:
 * `close` (vào Done: hỏi Cách giải quyết), `reopen` (rời Done) và `return` (đi ngược trong cùng nhóm chưa xong,
 * kể cả "Tạm dừng"): hỏi lý do (tuỳ chọn). `forward` chạy thẳng, không hộp thoại — ca đa số, không thêm ma sát.
 */
export function transitionKind(
  from: { category: string; order: number },
  to: { category: string; order: number },
): TransitionKind {
  if (to.category === 'DONE' && from.category !== 'DONE') return 'close';
  if (from.category === 'DONE' && to.category !== 'DONE') return 'reopen';
  if (from.category !== 'DONE' && to.category !== 'DONE' && to.order < from.order) return 'return';
  return 'forward';
}

/** Cách giải quyết chọn sẵn trong hộp: mức `isDefault`; không có thì mức đầu danh sách; rỗng => null. */
export function defaultResolutionId(
  list: ReadonlyArray<{ id: string; isDefault: boolean }>,
): string | null {
  return (list.find((r) => r.isDefault) ?? list[0])?.id ?? null;
}

/** Chip lý do nhanh chỉ ĐIỀN vào ô: nối vào cuối nội dung đang có (ngăn bằng dấu phẩy), không ghi đè chữ người dùng đã gõ. */
export function appendReason(current: string, chip: string): string {
  const t = current.trim();
  if (!t) return chip;
  if (t.toLowerCase().includes(chip.toLowerCase())) return current;
  return `${t.replace(/[.,;]$/, '')}, ${chip.charAt(0).toLowerCase()}${chip.slice(1)}`;
}
