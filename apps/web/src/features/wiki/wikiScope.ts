/** Hàm thuần cho quyền theo phạm vi của wiki (test được không cần DOM). */

export interface WikiCanCtx {
  /** Có quyền ở cấp workspace (áp cho tài liệu chung, `projectId = null`). */
  wsCan: boolean;
  /** Quyền theo từng dự án: true/false, `undefined` = quyền dự án đó đang tải. */
  projectCan: (projectId: string) => boolean | undefined;
  /**
   * Dự án KHÔNG còn dùng được để ghi (đã lưu trữ — không nằm trong danh sách dự án đang hoạt động): coi là không có
   * quyền ghi, không phải "đang tải". Bỏ trống = chưa biết danh sách → không loại ai.
   */
  inactive?: (projectId: string) => boolean;
}

/**
 * Có quyền ở phạm vi của một trang không: trang chung → quyền workspace; trang của dự án → quyền dự án.
 * Quyền dự án đang tải hoặc dự án đã lưu trữ → false (không bày nút rồi bị 403/422). Dùng cho cả `wiki:manage`
 * (sửa/tạo/đổi chỗ) lẫn `project:admin` (xoá) — gọi hai lần với hai bản đồ quyền.
 */
export function canWriteAt(projectId: string | null, ctx: WikiCanCtx): boolean {
  if (projectId === null) return ctx.wsCan;
  if (ctx.inactive?.(projectId)) return false;
  return ctx.projectCan(projectId) === true;
}

/** Quyền ghi của trang còn ĐANG TẢI không (chỉ khi dự án còn hoạt động mà quyền chưa về) — dự án lưu trữ thì không chờ. */
export function writeLoadingAt(projectId: string | null, ctx: WikiCanCtx): boolean {
  if (projectId === null || ctx.inactive?.(projectId)) return false;
  return ctx.projectCan(projectId) === undefined;
}

/**
 * Chỉ tra quyền cho dự án của phạm vi đang xem + dự án của trang đang mở (bỏ dự án đã lưu trữ); các dự án khác
 * trong cây "Tất cả" tra lười khi người dùng rê/mở hàng — không bắn N request khi mở `/wiki`.
 */
export function projectIdsToCheck(
  scopeProjectId: string | null,
  pageProjectId: string | null | undefined,
  inactive?: (projectId: string) => boolean,
): string[] {
  const ids = new Set<string>();
  for (const id of [scopeProjectId, pageProjectId]) if (id && !inactive?.(id)) ids.add(id);
  return [...ids];
}

const ASK_TAIL = '(quản trị) cấp quyền viết tài liệu cho vai trò của bạn.';

/** Câu "Nhờ … cấp quyền" nêu tên người quản trị; danh sách rỗng → '' (nơi gọi dùng câu dự phòng). */
export function askWhoText(names: readonly string[]): string {
  if (!names.length) return '';
  if (names.length <= 3) return `Nhờ ${names.join(', ')} ${ASK_TAIL}`;
  const rest = names.length - 3;
  return `Nhờ ${names.slice(0, 3).join(', ')} và ${rest} người khác ${ASK_TAIL}`;
}

/** Câu hiển thị cho người thiếu quyền viết: nêu tên quản trị, hoặc dự phòng khi không có ai. */
export function noWriteMessage(names: readonly string[]): string {
  return (
    askWhoText(names) || 'Hãy liên hệ quản trị không gian làm việc để được cấp quyền viết tài liệu.'
  );
}
