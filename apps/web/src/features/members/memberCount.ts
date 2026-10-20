import type { MemberDto } from '@tirapro/types';

/** Số thành viên ĐANG HOẠT ĐỘNG (không tính tài khoản bị vô hiệu hoá) — cùng số bộ chọn không gian làm việc hiển thị. */
export function countActiveMembers(members: readonly Pick<MemberDto, 'user'>[]): number {
  return members.filter((m) => m.user.status !== 'DEACTIVATED').length;
}

/** Chữ ở đầu danh sách: "N đang hoạt động" + (nếu có) "M đã vô hiệu hoá". Hàng bị vô hiệu hoá vẫn được liệt kê. */
export function memberCountParts(members: readonly Pick<MemberDto, 'user'>[]): {
  active: string;
  deactivated: string | null;
} {
  const active = countActiveMembers(members);
  const off = members.length - active;
  return {
    active: `${active} đang hoạt động`,
    deactivated: off > 0 ? `${off} đã vô hiệu hoá` : null,
  };
}
