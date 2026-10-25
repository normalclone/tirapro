import { toast, type ExternalToast } from 'sonner';

/**
 * Thay HẲN một toast đang hiện bằng id đó. Sonner gộp `{...toastCũ, ...dữ liệuMới}` khi cùng `id`, nên khoá không
 * truyền sẽ GIỮ giá trị cũ (nút Hoàn tác, mô tả, callback đóng của lần trước). Ở đây các khoá đó luôn có mặt và
 * (gồm `duration`) bằng `undefined` trừ khi `opts` cung cấp — spread của khoá `undefined` mới ghi đè được.
 */
export function toastReplace(
  id: string,
  kind: 'success' | 'error',
  message: string,
  opts: Omit<ExternalToast, 'id'> = {},
): void {
  const data: ExternalToast = {
    action: undefined,
    description: undefined,
    duration: undefined, // rơi về mặc định của Toaster (không giữ thời lượng của toast cũ)
    onDismiss: undefined,
    onAutoClose: undefined,
    ...opts,
    id,
  };
  if (kind === 'error') toast.error(message, data);
  else toast.success(message, data);
}
