/** Mã lỗi màn Thành viên (API: 409) → câu tiếng Việt rõ ràng; mã khác trả undefined để dùng cách báo lỗi chung. */
export const ALREADY_MEMBER = 'ALREADY_MEMBER';
export const LAST_WORKSPACE_ADMIN = 'LAST_WORKSPACE_ADMIN';

export function memberErrorText(code: string | undefined, personName?: string): string | undefined {
  if (code === ALREADY_MEMBER) return `${personName?.trim() || 'Người này'} đã là thành viên.`;
  if (code === LAST_WORKSPACE_ADMIN)
    return 'Không thể hạ hoặc gỡ quản trị viên cuối cùng của không gian làm việc.';
  return undefined;
}
