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

describe('UsersService.changePassword — thu hồi phiên', () => {
  it('đổi mật khẩu: đặt mốc sessionsRevokedAt, thu hồi mọi refresh token, xoá link quên mật khẩu — một transaction', async () => {
    const argon2 = await import('argon2');
    const passwordHash = await argon2.hash('Old-Passw0rd');
    const tx = {
      user: { update: vi.fn(() => Promise.resolve({})) },
      refreshToken: { updateMany: vi.fn(() => Promise.resolve({ count: 2 })) },
      passwordResetToken: { deleteMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    };
    const prisma = {
      user: { findUnique: vi.fn(() => Promise.resolve({ id: 'u1', passwordHash })) },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    const service = new UsersService(prisma as never, {} as never);
    await expect(
      service.changePassword('u1', {
        currentPassword: 'Old-Passw0rd',
        newPassword: 'New-Passw0rd1',
      }),
    ).resolves.toEqual({ success: true, revokedAtMs: expect.any(Number) as unknown });
    const upd = tx.user.update.mock.calls[0] as unknown as [
      { where: { id: string }; data: { passwordHash: string; sessionsRevokedAt: Date } },
    ];
    expect(upd[0].where).toEqual({ id: 'u1' });
    expect(upd[0].data.sessionsRevokedAt).toBeInstanceOf(Date);
    expect(await argon2.verify(upd[0].data.passwordHash, 'New-Passw0rd1')).toBe(true);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });
    expect(tx.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', usedAt: null },
    });
  });

  it('mật khẩu hiện tại sai -> không ghi gì', async () => {
    const argon2 = await import('argon2');
    const passwordHash = await argon2.hash('Old-Passw0rd');
    const prisma = {
      user: { findUnique: vi.fn(() => Promise.resolve({ id: 'u1', passwordHash })) },
      $transaction: vi.fn(),
    };
    const service = new UsersService(prisma as never, {} as never);
    await expect(
      service.changePassword('u1', {
        currentPassword: 'Wrong-Passw0rd',
        newPassword: 'New-Passw0rd1',
      }),
    ).rejects.toThrow(/không đúng/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
