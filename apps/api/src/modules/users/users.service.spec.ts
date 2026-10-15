import { describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

describe('UsersService — escape ký tự đại diện LIKE khi tìm người dùng', () => {
  const expected = [
    { displayName: { contains: '\\_', mode: 'insensitive' } },
    { email: { contains: '\\_', mode: 'insensitive' } },
  ];

  it('listWorkspaceMembers: search="_" không khớp mọi người', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService({ workspaceMembership: { findMany } } as never, {} as never);
    await service.listWorkspaceMembers('w1', '_');
    const call = findMany.mock.calls[0] as unknown as [{ where: { user: { OR: unknown[] } } }];
    expect(call[0].where.user.OR).toEqual(expected);
  });

  it('listAllUsers: search="_" không khớp mọi người', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService({ user: { findMany } } as never, {} as never);
    await service.listAllUsers('_');
    const call = findMany.mock.calls[0] as unknown as [
      { where: { AND: [unknown, { OR: unknown[] }] } },
    ];
    expect(call[0].where.AND[1].OR).toEqual(expected);
  });

  it('listAllUsers: pool không có tài khoản vô hiệu hoá và người dùng hệ thống automation', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService({ user: { findMany } } as never, {} as never);
    await service.listAllUsers();
    const call = findMany.mock.calls[0] as unknown as [{ where: unknown }];
    expect(call[0].where).toEqual({
      status: { not: 'DEACTIVATED' },
      email: { not: 'automation@tirapro.local' },
    });
  });

  it('listAllUsers: có search thì kết hợp AND với điều kiện loại trừ', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService({ user: { findMany } } as never, {} as never);
    await service.listAllUsers('tester');
    const call = findMany.mock.calls[0] as unknown as [{ where: { AND: unknown[] } }];
    expect(call[0].where.AND[0]).toEqual({
      status: { not: 'DEACTIVATED' },
      email: { not: 'automation@tirapro.local' },
    });
  });

  it('listAllUsers: DTO pool chỉ gồm id/email/tên/avatar/trạng thái', async () => {
    const row = {
      id: 'u1',
      email: 'a@x.vn',
      displayName: 'An',
      avatarUrl: null,
      status: 'ACTIVE',
      isSystemAdmin: true,
      lastSeenAt: new Date(),
      timezone: 'UTC',
      locale: 'vi',
      createdAt: new Date(),
      passwordHash: 'secret',
    };
    const findMany = vi.fn(() => Promise.resolve([row]));
    const service = new UsersService({ user: { findMany } } as never, {} as never);
    const out = await service.listAllUsers();
    expect(Object.keys(out[0]!).sort()).toEqual([
      'avatarUrl',
      'displayName',
      'email',
      'id',
      'status',
    ]);
  });
});
