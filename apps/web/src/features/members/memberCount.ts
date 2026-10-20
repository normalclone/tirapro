import type { MemberDto } from '@tirapro/types';

/** Số thành viên ĐANG HOẠT ĐỘNG (không tính tài khoản bị vô hiệu hoá) — cùng số bộ chọn không gian làm việc hiển thị. */
export function countActiveMembers(members: readonly Pick<MemberDto, 'user'>[]): number {
  return members.filter((m) => m.user.status !== 'DEACTIVATED').length;
}
