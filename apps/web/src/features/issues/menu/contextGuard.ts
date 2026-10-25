/**
 * Trên máy lai (con trỏ chính là chuột nhưng có màn hình cảm ứng) `ContextMenu.Trigger` không bị tắt theo `pointer: coarse`.
 * Cử chỉ cuối là cảm ứng/bút thì `contextmenu` theo sau (nhấn giữ) phải bị chặn: dnd-kit đã dùng nhấn giữ để nhấc thẻ,
 * không để nó mở thêm menu. Bàn phím (Shift+F10/phím Menu) và chuột vẫn mở bình thường.
 */
export const shouldSuppressContextMenu = (lastPointerType: string | null): boolean =>
  lastPointerType === 'touch' || lastPointerType === 'pen';
