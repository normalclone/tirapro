/** Hàm thuần cho quyền theo phạm vi của wiki (test được không cần DOM). */

export interface WikiCanCtx {
  /** Có quyền ở cấp workspace (áp cho tài liệu chung, `projectId = null`). */
  wsCan: boolean;
  /** Quyền theo từng dự án: true/false, `undefined` = quyền dự án đó đang tải. */
  projectCan: (projectId: string) => boolean | undefined;
}

/**
 * Có quyền ở phạm vi của một trang không: trang chung → quyền workspace; trang của dự án → quyền dự án.
 * Quyền dự án đang tải → false (không bày nút rồi bị 403). Dùng cho cả `wiki:manage` (sửa/tạo/đổi chỗ)
 * lẫn `project:admin` (xoá) — gọi hai lần với hai bản đồ quyền.
 */
export function canWriteAt(projectId: string | null, ctx: WikiCanCtx): boolean {
  return projectId === null ? ctx.wsCan : ctx.projectCan(projectId) === true;
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
  return askWhoText(names) || 'Hãy liên hệ quản trị workspace để được cấp quyền viết tài liệu.';
}
