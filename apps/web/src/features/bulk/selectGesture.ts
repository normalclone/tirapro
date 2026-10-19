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
