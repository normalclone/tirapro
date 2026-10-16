import { PERMISSIONS, type MemberUserDto, type UserRefDto } from '@tirapro/types';
import { iso } from './date';

/** Cột user công khai trả cho client — dùng làm `select` để không lộ passwordHash & co. */
export const USER_DTO_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  timezone: true,
  locale: true,
  status: true,
  isSystemAdmin: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

/** Hàng user tối thiểu cần có để dựng UserDto (khớp `USER_DTO_SELECT`). */
export interface UserDtoSource<S extends string = string> {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  status: S;
  isSystemAdmin: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
}

/** Dựng UserDto dùng chung (giữ kiểu enum của `status` nếu hàng nguồn có kiểu hẹp hơn string). */
export function toUserDto<S extends string>(u: UserDtoSource<S>) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    timezone: u.timezone,
    locale: u.locale,
    status: u.status,
    isSystemAdmin: u.isSystemAdmin,
    lastSeenAt: iso(u.lastSeenAt),
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * Người dùng NHÚNG trong dữ liệu khác (người phụ trách/báo lỗi của công việc, tác giả bình luận): chỉ định danh + hiển thị,
 * KHÔNG mang `isSystemAdmin` / `lastSeenAt` — mọi người xem việc đều nhận DTO này, không nên biết ai là quản trị hệ thống
 * hay ai vừa hoạt động lúc nào.
 */
export function toUserRefDto(u: Omit<UserDtoSource, 'isSystemAdmin' | 'lastSeenAt'>): UserRefDto {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    timezone: u.timezone,
    locale: u.locale,
    status: u.status as UserRefDto['status'],
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * Người dùng trong danh sách thành viên / `GET /users`: `isSystemAdmin` và `lastSeenAt` CHỈ khi người xem có
 * `member:manage` (`privileged`); người khác nhận bản rút gọn như `toUserRefDto`.
 */
export function memberUserForViewer(
  u: ReturnType<typeof toUserDto>,
  privileged: boolean,
): MemberUserDto {
  if (privileged) return u as MemberUserDto;
  const { isSystemAdmin: _a, lastSeenAt: _b, ...ref } = u;
  return ref as MemberUserDto;
}

/** Người xem có thấy các trường quản trị của người khác (`isSystemAdmin`, `lastSeenAt`) không: admin hệ thống hoặc `member:manage`. */
export function canSeeAdminUserFields(viewer: {
  isSystemAdmin?: boolean;
  permissions?: readonly string[];
}): boolean {
  return !!viewer.isSystemAdmin || !!viewer.permissions?.includes(PERMISSIONS.MEMBER_MANAGE);
}
