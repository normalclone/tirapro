import { describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

describe('UsersService — escape ký tự đại diện LIKE khi tìm người dùng', () => {
  const expected = [
    { displayName: { contains: '\\_', mode: 'insensitive' } },
    { email: { contains: '\\_', mode: 'insensitive' } },
  ];

  it('listWorkspaceMembers: search="_" không khớp mọi người', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService(
      { workspaceMembership: { findMany }, $queryRaw: vi.fn(() => Promise.resolve([])) } as never,
      {} as never,
      {} as never,
    );
    await service.listWorkspaceMembers('w1', 'v1', { search: '_' }, false);
    const call = findMany.mock.calls[0] as unknown as [{ where: { user: { OR: unknown[] } } }];
    expect(call[0].where.user.OR).toEqual(expected);
  });

  it('listAllUsers: search="_" không khớp mọi người', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService({ user: { findMany } } as never, {} as never, {} as never);
    await service.listAllUsers('_');
    const call = findMany.mock.calls[0] as unknown as [
      { where: { AND: [unknown, { OR: unknown[] }] } },
    ];
    expect(call[0].where.AND[1].OR).toEqual(expected);
  });

  it('listAllUsers: pool không có tài khoản vô hiệu hoá và người dùng hệ thống automation', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService({ user: { findMany } } as never, {} as never, {} as never);
    await service.listAllUsers();
    const call = findMany.mock.calls[0] as unknown as [{ where: unknown }];
    expect(call[0].where).toEqual({
      status: { not: 'DEACTIVATED' },
      email: { not: 'automation@tirapro.local' },
    });
  });

  it('listAllUsers: có search thì kết hợp AND với điều kiện loại trừ', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService({ user: { findMany } } as never, {} as never, {} as never);
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
    const service = new UsersService({ user: { findMany } } as never, {} as never, {} as never);
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
    const service = new UsersService(prisma as never, {} as never, {} as never);
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
    const service = new UsersService(prisma as never, {} as never, {} as never);
    await expect(
      service.changePassword('u1', {
        currentPassword: 'Wrong-Passw0rd',
        newPassword: 'New-Passw0rd1',
      }),
    ).rejects.toThrow(/không đúng/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

/** Dựng service với danh sách thành viên giả (đã sắp theo thứ tự `createdAt`). */
function listFixture(
  rows: Array<{ id: string; status?: string; email?: string }>,
  opts: { canSee?: (userId: string) => boolean; rawIds?: string[] } = {},
) {
  const user = (r: { id: string; status?: string; email?: string }) => ({
    id: r.id,
    email: r.email ?? `${r.id}@x.vn`,
    displayName: `Người ${r.id}`,
    avatarUrl: null,
    timezone: 'UTC',
    locale: 'vi',
    status: r.status ?? 'ACTIVE',
    isSystemAdmin: r.id === 'adm',
    lastSeenAt: new Date('2026-10-16T01:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'),
  });
  const findMany = vi.fn(
    (a: { take: number; cursor?: { id: string }; skip?: number }): Promise<unknown[]> => {
      const start = a.cursor ? rows.findIndex((r) => `m-${r.id}` === a.cursor!.id) + 1 : 0;
      return Promise.resolve(
        rows.slice(start, start + a.take).map((r) => ({ id: `m-${r.id}`, user: user(r) })),
      );
    },
  );
  const access = {
    assertCanSee: vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve()),
    canSee: vi.fn((userId: string) => Promise.resolve(opts.canSee ? opts.canSee(userId) : true)),
  };
  const prisma = {
    workspaceMembership: { findMany },
    $queryRaw: vi.fn((..._a: unknown[]) =>
      Promise.resolve((opts.rawIds ?? []).map((id) => ({ id }))),
    ),
  };
  const service = new UsersService(prisma as never, {} as never, access as never);
  return { service, findMany, access, prisma };
}

describe('UsersService.listWorkspaceMembers — bộ chọn người phía server (S-I7)', () => {
  it('mặc định loại tài khoản đã khoá và người dùng hệ thống automation; includeInactive giữ lại', async () => {
    const a = listFixture([{ id: 'u1' }]);
    await a.service.listWorkspaceMembers('w1', 'v1', {}, false);
    expect(
      (a.findMany.mock.calls[0]![0] as unknown as { where: { user: unknown } }).where.user,
    ).toEqual({
      status: { not: 'DEACTIVATED' },
      email: { not: 'automation@tirapro.local' },
    });
    const b = listFixture([{ id: 'u1' }]);
    await b.service.listWorkspaceMembers('w1', 'v1', { includeInactive: true }, false);
    expect(
      (b.findMany.mock.calls[0]![0] as unknown as { where: { user: unknown } }).where.user,
    ).toEqual({});
  });

  it('limit: mặc định 50, tối đa 200, tối thiểu 1', async () => {
    const take = async (limit?: number) => {
      const f = listFixture([]);
      await f.service.listWorkspaceMembers('w1', 'v1', { limit }, false);
      return (f.findMany.mock.calls[0]![0] as unknown as { take: number }).take;
    };
    expect(await take(undefined)).toBe(50);
    expect(await take(120)).toBe(120);
    expect(await take(9999)).toBe(200);
    expect(await take(-5)).toBe(1);
  });

  it('projectId: người gọi không xem được dự án => 404 (assertCanSee ném), không truy vấn danh sách', async () => {
    const f = listFixture([{ id: 'u1' }]);
    f.access.assertCanSee.mockRejectedValueOnce(Object.assign(new Error('Dự án'), { status: 404 }));
    await expect(
      f.service.listWorkspaceMembers('w1', 'v1', { projectId: 'pHidden' }, false),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.access.assertCanSee).toHaveBeenCalledWith('v1', 'w1', 'pHidden');
    expect(f.findMany).not.toHaveBeenCalled();
  });

  it('projectId (dự án riêng tư): chỉ trả người canSee dự án; limit áp SAU lọc (lấy thêm lô cho đủ)', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}` }));
    // chỉ u3, u7, u9, u11 xem được dự án
    const ok = new Set(['u3', 'u7', 'u9', 'u11']);
    const f = listFixture(rows, { canSee: (id) => ok.has(id) });
    const out = await f.service.listWorkspaceMembers(
      'w1',
      'v1',
      { projectId: 'p1', limit: 3 },
      false,
    );
    expect(out.map((u) => u.id)).toEqual(['u3', 'u7', 'u9']);
    expect(f.access.canSee).toHaveBeenCalledWith('u3', 'w1', 'p1');
    expect(f.findMany.mock.calls.length).toBeGreaterThan(1); // lô đầu (6) chưa đủ 3 người → lấy lô tiếp
  });

  it('không có projectId => không gọi canSee, chỉ một truy vấn', async () => {
    const f = listFixture([{ id: 'u1' }, { id: 'u2' }]);
    const out = await f.service.listWorkspaceMembers('w1', 'v1', {}, false);
    expect(out).toHaveLength(2);
    expect(f.access.canSee).not.toHaveBeenCalled();
    expect(f.access.assertCanSee).not.toHaveBeenCalled();
    expect(f.findMany).toHaveBeenCalledTimes(1);
  });

  it('search: so khớp tên/email không phân biệt hoa thường VÀ dấu (thêm nhánh id từ truy vấn bỏ dấu)', async () => {
    const f = listFixture([{ id: 'u1' }], { rawIds: ['uNguyen'] });
    await f.service.listWorkspaceMembers('w1', 'v1', { search: ' nguyen ' }, false);
    const where = (
      f.findMany.mock.calls[0]![0] as unknown as { where: { user: { OR: unknown[] } } }
    ).where;
    expect(where.user.OR).toEqual([
      { displayName: { contains: 'nguyen', mode: 'insensitive' } },
      { email: { contains: 'nguyen', mode: 'insensitive' } },
      { id: { in: ['uNguyen'] } },
    ]);
    expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('truy vấn bỏ dấu lỗi => vẫn tìm được bằng so khớp thường (không 500)', async () => {
    const f = listFixture([{ id: 'u1' }]);
    f.prisma.$queryRaw.mockRejectedValueOnce(new Error('translate'));
    await expect(
      f.service.listWorkspaceMembers('w1', 'v1', { search: 'an' }, false),
    ).resolves.toHaveLength(1);
  });

  it('isSystemAdmin/lastSeenAt chỉ cho người có member:manage', async () => {
    const f = listFixture([{ id: 'adm' }]);
    const plain = await f.service.listWorkspaceMembers('w1', 'v1', {}, false);
    expect(plain[0]).not.toHaveProperty('isSystemAdmin');
    expect(plain[0]).not.toHaveProperty('lastSeenAt');
    const priv = await f.service.listWorkspaceMembers('w1', 'v1', {}, true);
    expect(priv[0]).toMatchObject({ isSystemAdmin: true, lastSeenAt: '2026-10-16T01:00:00.000Z' });
  });
});
