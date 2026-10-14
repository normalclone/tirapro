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
