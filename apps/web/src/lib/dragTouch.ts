/**
 * Dòng/thẻ kéo được bằng cảm ứng (nhấn giữ 250ms, xem `dragSensors`): trên iOS, nhấn giữ lên chữ/liên kết sẽ bật chọn chữ hoặc
 * menu xem trước liên kết và giành mất cử chỉ kéo. Chỉ ở `pointer: coarse` (desktop không đổi). Dùng cho gốc dòng/thẻ VÀ mọi
 * liên kết bên trong nó (Board `Card`, Việc chờ `IssueRow`, Cây việc `TreeRow` + tiêu đề).
 */
export const COARSE_NO_CALLOUT =
  '[@media(pointer:coarse)]:select-none [@media(pointer:coarse)]:[-webkit-touch-callout:none]';
