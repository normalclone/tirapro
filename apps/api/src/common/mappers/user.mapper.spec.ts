import { describe, expect, it } from 'vitest';
import { canSeeAdminUserFields, toUserDto, toUserRefDto } from './user.mapper';

const row = {
  id: 'u1',
  email: 'a@x.vn',
  displayName: 'An',
  avatarUrl: null,
  timezone: 'UTC',
  locale: 'vi',
  status: 'ACTIVE' as const,
  isSystemAdmin: true,
  lastSeenAt: new Date('2026-10-16T01:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
};

describe('user mapper — người nhúng không lộ trường quản trị', () => {
  it('toUserRefDto (assignee/reporter/author) không mang isSystemAdmin, lastSeenAt', () => {
    const dto = toUserRefDto(row);
    expect(dto).not.toHaveProperty('isSystemAdmin');
    expect(dto).not.toHaveProperty('lastSeenAt');
    expect(dto).toMatchObject({ id: 'u1', displayName: 'An', email: 'a@x.vn' });
  });

  it('toUserDto (hồ sơ của chính mình, /auth) vẫn đủ trường', () => {
    expect(toUserDto(row)).toMatchObject({
      isSystemAdmin: true,
      lastSeenAt: expect.any(String) as unknown,
    });
  });

  it('canSeeAdminUserFields: admin hệ thống hoặc member:manage', () => {
    expect(canSeeAdminUserFields({ isSystemAdmin: true })).toBe(true);
    expect(canSeeAdminUserFields({ permissions: ['member:manage'] })).toBe(true);
    expect(canSeeAdminUserFields({ permissions: ['workspace:view'] })).toBe(false);
    expect(canSeeAdminUserFields({})).toBe(false);
  });
});
