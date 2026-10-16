/**
 * Chặn lưu khi còn ô ngày/giờ đang gõ sai. `DateInput`/`DateTimeInput` đặt `customValidity` cho ô (và gắn
 * `data-custom-validity`) — form native tự chặn gửi, nhưng hộp thoại không có `<form>` (nút Lưu `type=button`,
 * Cmd/Ctrl+Enter) thì phải gọi guard này trước khi lưu.
 */

/** Phần tử đầu tiên đang có lỗi tuỳ chỉnh (thuần — test được không cần DOM). */
export function firstInvalid<T extends { validity: { customError: boolean } }>(
  els: Iterable<T>,
): T | undefined {
  for (const el of els) if (el.validity.customError) return el;
  return undefined;
}

/** Vùng cần kiểm: truyền sẵn, hoặc hộp thoại trên cùng đang mở, hoặc cả tài liệu. */
function scopeOf(root?: ParentNode | null): ParentNode {
  if (root) return root;
  const dialogs = document.querySelectorAll('[role="dialog"]');
  return dialogs.length > 0 ? dialogs[dialogs.length - 1]! : document;
}

/**
 * Có ô ngày/giờ đang sai trong `root` không? Nếu có: đưa con trỏ về ô đó (rời rồi vào lại để ô hiện dòng lỗi đỏ ngay
 * cả khi người dùng đang đứng trong chính ô) và hiện bong bóng báo lỗi của trình duyệt; trả `true` → chặn lưu.
 */
export function blockOnInvalidDate(root?: ParentNode | null): boolean {
  const bad = firstInvalid(
    scopeOf(root).querySelectorAll<HTMLInputElement>('input[data-custom-validity]'),
  );
  if (!bad) return false;
  bad.blur();
  bad.focus();
  bad.reportValidity();
  return true;
}
