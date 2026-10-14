import { describe, expect, it } from 'vitest';
import { iso } from './date';
import { toUserDto } from './user.mapper';

describe('iso', () => {
  it('trả null cho null/undefined và ISO cho Date', () => {
    expect(iso(null)).toBeNull();
    expect(iso(undefined)).toBeNull();
    expect(iso(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
  });
});

describe('toUserDto', () => {
  it('chỉ trả các cột công khai và đổi ngày sang ISO', () => {
    const dto = toUserDto({
      id: 'u1', email: 'a@b.c', displayName: 'A', avatarUrl: null, timezone: 'UTC', locale: 'vi',
      status: 'ACTIVE', isSystemAdmin: false, lastSeenAt: null, createdAt: new Date('2026-01-01T00:00:00.000Z'),
      // @ts-expect-error cột thừa (vd passwordHash) không được lọt ra DTO
      passwordHash: 'x',
    });
    expect(dto).toEqual({
      id: 'u1', email: 'a@b.c', displayName: 'A', avatarUrl: null, timezone: 'UTC', locale: 'vi',
      status: 'ACTIVE', isSystemAdmin: false, lastSeenAt: null, createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
