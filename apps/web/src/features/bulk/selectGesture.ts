interface ClickMods {
  button: number;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/**
 * Click trên thẻ có phải cử chỉ CHỌN không: Shift+click = chọn dải (kể cả khi bấm vào link mã — Shift trên link sẽ mở cửa sổ
 * mới nếu để trình duyệt xử lý); Cmd/Ctrl+click = bật/tắt thẻ, trừ trên link mã (giữ "mở tab mới"). Click thường, Alt,
 * chuột giữa/phải → `null` (xem nhanh / menu như cũ).
 */
export function selectGesture(e: ClickMods, onLink: boolean): 'range' | 'toggle' | null {
  if (e.button !== 0 || e.altKey) return null;
  if (e.shiftKey) return 'range';
  if (e.metaKey || e.ctrlKey) return onLink ? null : 'toggle';
  return null;
}

interface RangeClickEvent extends ClickMods {
  target: unknown;
  currentTarget: { contains: (n: Node) => boolean };
  preventDefault: () => void;
  stopPropagation: () => void;
}

/**
 * Pha BẮT trên dòng Bộ lọc: Shift+click ở thân dòng hoặc link mã = chọn dải (như thẻ Bảng việc). `preventDefault` chặn bôi
 * đen chữ và cửa sổ mới của link; `stopPropagation` để link/dòng không mở xem nhanh. Cmd/Ctrl+click (tab mới) và click thường
 * (xem nhanh) KHÔNG bị đụng; ô chọn/nút tự xử lý; sự kiện từ portal (ngoài dòng) bỏ qua. Trả về true nếu đã xử lý.
 */
export function handleShiftRangeClick(e: RangeClickEvent, onRange: () => void): boolean {
  const t = e.target as { closest?: (s: string) => unknown } | null;
  if (!e.currentTarget.contains(e.target as Node) || t?.closest?.('[data-no-peek], button'))
    return false;
  // `onLink = true` chỉ để lấy nhánh Shift: Cmd/Ctrl trả null (giữ hành vi mở tab mới của dòng).
  if (selectGesture(e, true) !== 'range') return false;
  e.preventDefault();
  e.stopPropagation();
  onRange();
  return true;
}
