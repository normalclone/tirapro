import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { MembersService } from './members.service';

describe('MembersService.addWorkspaceMany', () => {
  function setup() {
    const tx = {
      workspaceMembership: {
        createMany: vi.fn(() => Promise.resolve({ count: 2 })),
        findMany: vi.fn((args: { where: { userId?: unknown; roles?: unknown } }) =>
          Promise.resolve(args.where.roles ? [{ id: 'm1' }, { id: 'm2' }] : [{ userId: 'u3' }]),
        ), // u3 đã là thành viên
      },
      workspaceMembershipRole: {
        createMany: vi.fn((_args: { data: unknown[] }) => Promise.resolve({ count: 4 })),
      },
    };
    const prisma = {
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
      role: { findMany: vi.fn(() => Promise.resolve([{ id: 'r1' }, { id: 'r2' }])) },
      user: { findMany: vi.fn(() => Promise.resolve([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }])) },
      workspaceMembership: tx.workspaceMembership,
    };
    const rbac = { invalidate: vi.fn(), invalidateWorkspace: vi.fn() };
    const audit = { record: vi.fn() };
    return {
      service: new MembersService(
        prisma as never,
        rbac as never,
        { revokeAllForUser: vi.fn(), dropCaches: vi.fn() } as never,
        { emit: vi.fn() } as never,
        audit as never,
      ),
      prisma,
      tx,
      rbac,
      audit,
    };
  }

  it('thêm cả lô trong một transaction và invalidate RBAC một lần cho workspace', async () => {
    const { service, prisma, tx, rbac } = setup();
    const res = await service.addWorkspaceMany('w1', ['u1', 'u2', 'u3'], ['r1', 'r2']);
    expect(res).toEqual({ added: 2, skipped: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.workspaceMembership.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({ userId: 'u1', roleId: 'r1' }),
          expect.objectContaining({ userId: 'u2', roleId: 'r1' }),
        ],
      }),
    );
    const roleRows = tx.workspaceMembershipRole.createMany.mock.calls[0]![0].data;
    expect(roleRows).toHaveLength(4); // 2 membership x 2 vai trò
    expect(rbac.invalidateWorkspace).toHaveBeenCalledTimes(1);
    expect(rbac.invalidate).not.toHaveBeenCalled();
  });

  it('không có ai cần thêm => không mở transaction, không invalidate', async () => {
    const { service, prisma, rbac } = setup();
    prisma.user.findMany.mockResolvedValue([{ id: 'u3' }]);
    const res = await service.addWorkspaceMany('w1', ['u3'], ['r1', 'r2']);
    expect(res).toEqual({ added: 0, skipped: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(rbac.invalidateWorkspace).not.toHaveBeenCalled();
  });
});

describe('MembersService.removeWorkspace', () => {
  function setup() {
    const tx = {
      workspaceMembership: { delete: vi.fn(() => Promise.resolve({})) },
      projectMembership: { deleteMany: vi.fn(() => Promise.resolve({ count: 2 })) },
    };
    const prisma = {
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
      workspace: { findUnique: vi.fn(() => Promise.resolve({ ownerId: 'owner' })) },
      user: {
        findUnique: vi.fn(() => Promise.resolve({ displayName: 'Bình', email: 'ba@x.vn' })),
      },
      project: { findMany: vi.fn((_a?: unknown) => Promise.resolve([] as unknown[])) },
      // mặc định người bị gỡ KHÔNG phải quản trị workspace (count=0); ca quản trị cuối cùng ghi đè
      workspaceMembership: { count: vi.fn((_a?: unknown) => Promise.resolve(0)) },
    };
    const rbac = {
      invalidate: vi.fn(() => Promise.resolve()),
      assertProjectVisible: vi.fn((..._a: unknown[]) => Promise.resolve()),
    };
    const apiKeys = {
      revokeAllForUser: vi.fn(() => Promise.resolve(['pfx1', 'pfx2'])),
      dropCaches: vi.fn(() => Promise.resolve()),
    };
    const events = { emit: vi.fn() };
    const audit = { record: vi.fn() };
    const service = new MembersService(
      prisma as never,
      rbac as never,
      apiKeys as never,
      events as never,
      audit as never,
    );
    return { service, prisma, tx, rbac, apiKeys, events, audit };
  }

  it('gỡ membership + xoá ghi đè dự án + thu hồi API key trong CÙNG transaction, rồi invalidate + phát sự kiện', async () => {
    const { service, prisma, tx, rbac, apiKeys, events, audit } = setup();
    await expect(service.removeWorkspace('w1', 'u1', 'admin')).resolves.toEqual({ success: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.workspaceMembership.delete).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
    });
    expect(tx.projectMembership.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', project: { workspaceId: 'w1' } },
    });
    expect(apiKeys.revokeAllForUser).toHaveBeenCalledWith('w1', 'u1', tx);
    expect(apiKeys.dropCaches).toHaveBeenCalledWith(['pfx1', 'pfx2']);
    expect(rbac.invalidate).toHaveBeenCalledWith('u1', 'w1');
    expect(events.emit).toHaveBeenCalledWith('member.removed', { workspaceId: 'w1', userId: 'u1' });
    expect(audit.record.mock.calls[0]![0]).toMatchObject({
      workspaceId: 'w1',
      actorId: 'admin',
      action: 'member.removed',
      entityId: 'u1',
      summary: 'Gỡ Bình (ba@x.vn) khỏi không gian làm việc',
    });
  });

  it('transaction lỗi -> không invalidate, không phát sự kiện', async () => {
    const { service, prisma, rbac, events } = setup();
    prisma.$transaction.mockRejectedValue(new Error('boom'));
    await expect(service.removeWorkspace('w1', 'u1', 'admin')).rejects.toThrow('boom');
    expect(rbac.invalidate).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('là thành viên DUY NHẤT của dự án riêng tư => chặn, nêu mã dự án + lối thoát, không xoá gì', async () => {
    const { service, prisma, tx } = setup();
    prisma.project.findMany.mockResolvedValue([
      { id: 'pHR', key: 'HR', memberships: [{ userId: 'u1' }] },
      { id: 'pFIN', key: 'FIN', memberships: [{ userId: 'u1' }, { userId: 'u9' }] },
    ]);
    await expect(service.removeWorkspace('w1', 'u1', 'admin')).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/HR.*(thêm người khác|công khai)/s) as unknown,
    });
    expect(tx.workspaceMembership.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // chỉ HR bị nêu (FIN còn người khác)
    await service.removeWorkspace('w1', 'u1', 'admin').catch((e: Error) => {
      expect(e.message).toContain('HR');
      expect(e.message).not.toContain('FIN');
    });
  });

  it('lời lỗi chỉ nêu khoá dự án người gọi xem được; phần còn lại là "và N dự án riêng tư khác"', async () => {
    const { service, prisma, rbac } = setup();
    prisma.project.findMany.mockResolvedValue([
      { id: 'pHR', key: 'HR', memberships: [{ userId: 'u1' }] },
      { id: 'pSEC', key: 'SECRET', memberships: [{ userId: 'u1' }] },
      { id: 'pSEC2', key: 'SECRET2', memberships: [{ userId: 'u1' }] },
    ]);
    rbac.assertProjectVisible.mockImplementation((_u: unknown, _w: unknown, p: unknown) =>
      p === 'pHR' ? Promise.resolve() : Promise.reject(new NotFoundAppException('Dự án')),
    );
    const err = await service.removeWorkspace('w1', 'u1', 'admin').catch((e: Error) => e);
    expect((err as Error).message).toContain('HR');
    expect((err as Error).message).not.toContain('SECRET');
    expect((err as Error).message).toContain('2 dự án riêng tư khác');
  });

  it('gỡ quản trị workspace CUỐI CÙNG => 409 LAST_WORKSPACE_ADMIN, không xoá gì', async () => {
    const { service, prisma, tx } = setup();
    // count lần 1: người này là admin (1); lần 2: admin khác (0)
    prisma.workspaceMembership.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(service.removeWorkspace('w1', 'u1', 'admin')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'LAST_WORKSPACE_ADMIN' }) as unknown,
    });
    expect(tx.workspaceMembership.delete).not.toHaveBeenCalled();
  });

  it('gỡ một quản trị khi còn quản trị khác => được phép', async () => {
    const { service, prisma } = setup();
    prisma.workspaceMembership.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await expect(service.removeWorkspace('w1', 'u1', 'admin')).resolves.toEqual({ success: true });
  });

  it('truy vấn dự án riêng tư lọc workspace + chưa xoá + người đó là thành viên; không có dự án => gỡ bình thường', async () => {
    const { service, prisma } = setup();
    await service.removeWorkspace('w1', 'u1', 'admin');
    const where = (prisma.project.findMany.mock.calls[0]![0] as { where: object }).where;
    expect(where).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      isPrivate: true,
      memberships: { some: { userId: 'u1' } },
    });
  });

  it('không cho tự gỡ mình hoặc gỡ chủ sở hữu', async () => {
    const { service, tx } = setup();
    await expect(service.removeWorkspace('w1', 'admin', 'admin')).rejects.toThrow();
    await expect(service.removeWorkspace('w1', 'owner', 'admin')).rejects.toThrow();
    expect(tx.workspaceMembership.delete).not.toHaveBeenCalled();
  });
});

describe('MembersService.listWorkspace — phòng thủ bảng nối rỗng', () => {
  it('khi bảng nối rỗng thì rơi về vai trò chính (roleId/role)', async () => {
    const prisma = {
      workspaceMembership: {
        findMany: vi.fn(() =>
          Promise.resolve([
            {
              id: 'm1',
              roleId: 'r1',
              role: { id: 'r1', name: 'Workspace Admin', color: null },
              roles: [],
              joinedAt: null,
              user: {
                id: 'u1',
                email: 'a@x.vn',
                displayName: 'A',
                avatarUrl: null,
                timezone: 'UTC',
                locale: 'vi',
                status: 'ACTIVE',
                isSystemAdmin: false,
                lastSeenAt: null,
                createdAt: new Date(),
              },
            },
          ]),
        ),
      },
    };
    const service = new MembersService(
      prisma as never,
      {} as never,
      {} as never,
      { emit: vi.fn() } as never,
      { record: vi.fn() } as never,
    );
    const out = await service.listWorkspace('w1');
    expect(out[0]!.roles).toEqual([{ id: 'r1', name: 'Workspace Admin', color: null }]);
  });
});

describe('MembersService — ghi nhật ký quản trị', () => {
  const userRow = {
    id: 'u2',
    email: 'ba@x.vn',
    displayName: 'Bình',
    avatarUrl: null,
    timezone: 'UTC',
    locale: 'vi',
    status: 'ACTIVE',
    isSystemAdmin: false,
    lastSeenAt: null,
    createdAt: new Date(),
  };
  const memberRow = {
    id: 'm2',
    joinedAt: new Date(),
    roleId: 'r1',
    role: { id: 'r1', name: 'Workspace Member', color: null },
    user: userRow,
    roles: [{ role: { id: 'r1', name: 'Workspace Member', color: null } }],
  };

  function setup(opts: { existing?: boolean; keepsAdmin?: boolean; createError?: unknown } = {}) {
    const prisma = {
      user: {
        findUnique: vi.fn(() =>
          Promise.resolve({ id: 'u2', displayName: 'Bình', email: 'ba@x.vn' }),
        ),
      },
      // role.count: bộ vai trò mới còn quyền workspace:admin (mặc định có → không đụng chốt "quản trị cuối cùng")
      role: {
        findMany: vi.fn(() => Promise.resolve([{ id: 'r1' }])),
        count: vi.fn(() => Promise.resolve(opts.keepsAdmin === false ? 0 : 1)),
      },
      workspaceMembership: {
        count: vi.fn((_a?: unknown) => Promise.resolve(0)),
        findUnique: vi.fn(() => Promise.resolve(opts.existing ? { id: 'm2' } : null)),
        create: vi.fn(() =>
          opts.createError ? Promise.reject(opts.createError as Error) : Promise.resolve({}),
        ),
        update: vi.fn(() => Promise.resolve({})),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(memberRow)),
      },
      workspaceMembershipRole: {
        deleteMany: vi.fn(() => Promise.resolve({})),
        createMany: vi.fn(() => Promise.resolve({})),
      },
      $transaction: vi.fn(() => Promise.resolve([])),
    };
    const audit = { record: vi.fn() };
    const events = { emit: vi.fn() };
    const svc = new MembersService(
      prisma as never,
      { invalidate: vi.fn() } as never,
      {} as never,
      events as never,
      audit as never,
    );
    return { svc, audit, events, prisma };
  }
  const first = (audit: { record: { mock: { calls: unknown[][] } } }) =>
    audit.record.mock.calls[0]![0] as Record<string, unknown>;

  it('setWorkspaceRoles(): phát access.changed {workspaceId, userIds:[user]} để gateway rà socket (S-I6)', async () => {
    const { svc, events } = setup({ existing: true });
    await svc.setWorkspaceRoles('w1', 'u2', ['r1'], 'actor');
    expect(events.emit).toHaveBeenCalledWith('access.changed', {
      workspaceId: 'w1',
      userIds: ['u2'],
    });
  });

  it('addWorkspace(): người ĐÃ là thành viên => 409 ALREADY_MEMBER, không ghi đè vai trò, không nhật ký', async () => {
    const { svc, audit, prisma, events } = setup({ existing: true });
    await expect(svc.addWorkspace('w1', 'u2', ['r1'], 'actor')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'ALREADY_MEMBER' }) as unknown,
    });
    expect(prisma.workspaceMembershipRole.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('addWorkspace(): hai request đồng thời (P2002 khi tạo) => 409, không phải 500', async () => {
    const { Prisma } = await import('@prisma/client');
    const { svc } = setup({
      createError: new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    });
    await expect(svc.addWorkspace('w1', 'u2', ['r1'], 'actor')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'ALREADY_MEMBER' }) as unknown,
    });
  });

  it('setWorkspaceRoles(): hạ quản trị workspace CUỐI CÙNG (vai trò mới không còn workspace:admin) => 409 LAST_WORKSPACE_ADMIN', async () => {
    const { svc, prisma } = setup({ existing: true, keepsAdmin: false });
    // lần 1: người này là admin; lần 2: không còn admin nào khác
    prisma.workspaceMembership.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(svc.setWorkspaceRoles('w1', 'u2', ['r1'], 'actor')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'LAST_WORKSPACE_ADMIN' }) as unknown,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('setWorkspaceRoles(): còn admin khác, hoặc vai trò mới vẫn có workspace:admin, hoặc người này không phải admin => được phép', async () => {
    const a = setup({ existing: true, keepsAdmin: false });
    a.prisma.workspaceMembership.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await expect(a.svc.setWorkspaceRoles('w1', 'u2', ['r1'], 'actor')).resolves.toBeDefined();
    const b = setup({ existing: true, keepsAdmin: true });
    await expect(b.svc.setWorkspaceRoles('w1', 'u2', ['r1'], 'actor')).resolves.toBeDefined();
    const c = setup({ existing: true, keepsAdmin: false }); // count mặc định 0 → không phải admin
    await expect(c.svc.setWorkspaceRoles('w1', 'u2', ['r1'], 'actor')).resolves.toBeDefined();
  });

  it('addWorkspace(): thành viên mới → member.added kèm tên, vai trò và người thực hiện', async () => {
    const { svc, audit } = setup();
    await svc.addWorkspace('w1', 'u2', ['r1'], 'actor');
    expect(first(audit)).toMatchObject({
      workspaceId: 'w1',
      actorId: 'actor',
      action: 'member.added',
      entityId: 'u2',
      summary: 'Thêm Bình (ba@x.vn) với vai trò Thành viên',
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('setWorkspaceRoles(): ghi member.roles_changed', async () => {
    const { svc, audit } = setup({ existing: true });
    await svc.setWorkspaceRoles('w1', 'u2', ['r1'], 'actor');
    expect(first(audit)).toMatchObject({
      workspaceId: 'w1',
      action: 'member.roles_changed',
      entityId: 'u2',
    });
  });
});

describe('MembersService.createAccount', () => {
  function setup(existingEmail = false) {
    const tx = {
      user: { create: vi.fn(() => Promise.resolve({ id: 'u9' })) },
      workspaceMembership: { create: vi.fn(() => Promise.resolve({ id: 'm9' })) },
    };
    const prisma = {
      user: { findUnique: vi.fn(() => Promise.resolve(existingEmail ? { id: 'u1' } : null)) },
      role: { findMany: vi.fn(() => Promise.resolve([{ id: 'r1' }])) },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
      workspaceMembership: {
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({
            id: 'm9',
            joinedAt: new Date(),
            roleId: 'r1',
            role: { id: 'r1', name: 'Workspace Member', color: null },
            user: {
              id: 'u9',
              email: 'a@x.vn',
              displayName: 'A',
              avatarUrl: null,
              timezone: 'UTC',
              locale: 'vi',
              status: 'ACTIVE',
              isSystemAdmin: false,
              lastSeenAt: null,
              createdAt: new Date(),
            },
            roles: [{ role: { id: 'r1', name: 'Workspace Member', color: null } }],
          }),
        ),
      },
    };
    const audit = { record: vi.fn() };
    const rbac = { invalidate: vi.fn() };
    const svc = new MembersService(
      prisma as never,
      rbac as never,
      {} as never,
      { emit: vi.fn() } as never,
      audit as never,
    );
    return { svc, tx, prisma, audit, rbac };
  }
  const arg = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls[0] as unknown[];

  it('tạo user + membership + vai trò trong một transaction, trả mật khẩu tạm khi không nhập', async () => {
    const { svc, tx, prisma, audit, rbac } = setup();
    const out = await svc.createAccount('w1', 'actor', {
      email: 'A@X.vn',
      displayName: 'A',
      roleIds: ['r1'],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect((arg(tx.user.create)[0] as { data: unknown }).data).toMatchObject({
      email: 'a@x.vn',
      displayName: 'A',
    });
    expect((arg(tx.workspaceMembership.create)[0] as { data: unknown }).data).toMatchObject({
      workspaceId: 'w1',
      userId: 'u9',
      roleId: 'r1',
      roles: { create: [{ roleId: 'r1' }] },
    });
    expect(out.tempPassword).toMatch(/^[A-Za-z0-9]{20,}$/);
    expect(out.member.user.id).toBe('u9');
    const [entry, txArg] = arg(audit.record);
    expect(entry).toMatchObject({
      action: 'member.account_created',
      workspaceId: 'w1',
      actorId: 'actor',
      entityId: 'u9',
    });
    expect(txArg).toBe(tx); // ghi cùng transaction
    expect(rbac.invalidate).toHaveBeenCalledWith('u9', 'w1');
  });

  it('không lưu mật khẩu thô: user.create nhận hash, không nhận tempPassword', async () => {
    const { svc, tx } = setup();
    const out = await svc.createAccount('w1', 'actor', {
      email: 'a@x.vn',
      displayName: 'A',
      roleIds: ['r1'],
    });
    const data = (arg(tx.user.create)[0] as { data: { passwordHash: string } }).data;
    expect(data.passwordHash).toMatch(/^\$argon2/);
    expect(data.passwordHash).not.toContain(out.tempPassword!);
  });

  it('có nhập mật khẩu thì không trả tempPassword', async () => {
    const { svc } = setup();
    const out = await svc.createAccount('w1', 'actor', {
      email: 'a@x.vn',
      displayName: 'A',
      roleIds: ['r1'],
      password: 'Password1',
    });
    expect(out.tempPassword).toBeUndefined();
  });

  it('email đã có tài khoản → từ chối với thông điệp chỉ cách thêm người có sẵn', async () => {
    const { svc, prisma } = setup(true);
    await expect(
      svc.createAccount('w1', 'actor', { email: 'a@x.vn', displayName: 'A', roleIds: ['r1'] }),
    ).rejects.toThrow(/đã có tài khoản/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('MembersService — chặn tài khoản không hợp lệ (M2/M3/M4)', () => {
  function setup(userRow: Record<string, unknown> | null) {
    const tx = {
      user: {
        create: vi.fn(() => Promise.resolve({ id: 'u9' })),
      },
      workspaceMembership: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      user: {
        findUnique: vi.fn(() => Promise.resolve(userRow)),
        findMany: vi.fn(() => Promise.resolve(userRow ? [userRow] : [])),
      },
      role: { findMany: vi.fn(() => Promise.resolve([{ id: 'r1' }])) },
      workspaceMembership: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        findMany: vi.fn(() => Promise.resolve([])),
        create: vi.fn(() => Promise.resolve({})),
      },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    const svc = new MembersService(
      prisma as never,
      { invalidate: vi.fn(), invalidateWorkspace: vi.fn() } as never,
      {} as never,
      { emit: vi.fn() } as never,
      { record: vi.fn() } as never,
    );
    return { svc, prisma, tx };
  }

  it('POST /members: từ chối tài khoản DEACTIVATED', async () => {
    const { svc, prisma } = setup({ id: 'u2', status: 'DEACTIVATED', email: 'x@x.vn' });
    await expect(svc.addWorkspace('w1', 'u2', ['r1'], 'a')).rejects.toThrow(/vô hiệu hoá/);
    expect(prisma.workspaceMembership.create).not.toHaveBeenCalled();
  });

  it('POST /members: từ chối người dùng hệ thống automation', async () => {
    const { svc } = setup({ id: 'u2', status: 'ACTIVE', email: 'automation@tirapro.local' });
    await expect(svc.addWorkspace('w1', 'u2', ['r1'], 'a')).rejects.toThrow(/tài khoản hệ thống/);
  });

  it('POST /members/bulk: từ chối cả lô nếu có tài khoản không hợp lệ', async () => {
    const { svc, prisma } = setup({ id: 'u2', status: 'DEACTIVATED', email: 'x@x.vn' });
    await expect(svc.addWorkspaceMany('w1', ['u2'], ['r1'], 'a')).rejects.toThrow(/vô hiệu hoá/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('createAccount: email của tài khoản bị vô hiệu hoá → thông điệp riêng, KHÔNG bảo chọn trong danh sách', async () => {
    const { svc } = setup({ id: 'u2', status: 'DEACTIVATED' });
    const err = await svc
      .createAccount('w1', 'a', { email: 'x@x.vn', displayName: 'X', roleIds: ['r1'] })
      .catch((e: Error) => e);
    expect((err as Error).message).toMatch(/vô hiệu hoá/);
    expect((err as Error).message).not.toMatch(/chọn người đó/);
  });

  it('createAccount: email đang dùng được → mã EMAIL_ALREADY_REGISTERED', async () => {
    const { svc } = setup({ id: 'u2', status: 'ACTIVE' });
    const err = (await svc
      .createAccount('w1', 'a', { email: 'x@x.vn', displayName: 'X', roleIds: ['r1'] })
      .catch((e: unknown) => e)) as { code?: string };
    expect(err.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('createAccount: hai request trùng email đồng thời (P2002) → cùng mã EMAIL_ALREADY_REGISTERED', async () => {
    const { Prisma } = await import('@prisma/client');
    const { svc, tx } = setup(null);
    tx.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    const err = (await svc
      .createAccount('w1', 'a', { email: 'x@x.vn', displayName: 'X', roleIds: ['r1'] })
      .catch((e: unknown) => e)) as { code?: string };
    expect(err.code).toBe('EMAIL_ALREADY_REGISTERED');
  });
});

function setupProject(opts: {
  hasOverride: boolean;
  deleteCount?: number;
  userStatus?: string;
  userEmail?: string;
}) {
  const member = {
    id: 'pm1',
    roleId: 'pr1',
    role: { id: 'pr1', name: 'Project Developer', color: null },
    roles: [{ role: { id: 'pr1', name: 'Project Developer', color: null } }],
    user: {
      id: 'u2',
      email: 'ba@x.vn',
      displayName: 'Bình',
      avatarUrl: null,
      timezone: 'UTC',
      locale: 'vi',
      status: 'ACTIVE',
      isSystemAdmin: false,
      lastSeenAt: null,
      createdAt: new Date(),
    },
  };
  const prisma = {
    project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1', name: 'Demo' })) },
    workspaceMembership: { findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })) },
    projectMembership: {
      findUnique: vi.fn(() => Promise.resolve(opts.hasOverride ? { id: 'pm1' } : null)),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(member)),
      deleteMany: vi.fn(() => Promise.resolve({ count: opts.deleteCount ?? 1 })),
    },
    projectMembershipRole: {
      deleteMany: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({})),
    },
    role: { findMany: vi.fn(() => Promise.resolve([{ id: 'pr1' }])) },
    user: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          displayName: 'Bình',
          email: opts.userEmail ?? 'ba@x.vn',
          status: opts.userStatus ?? 'ACTIVE',
        }),
      ),
      findMany: vi.fn(() =>
        Promise.resolve([
          { email: opts.userEmail ?? 'ba@x.vn', status: opts.userStatus ?? 'ACTIVE' },
        ]),
      ),
    },
    $transaction: vi.fn(() => Promise.resolve([])),
  };
  const audit = { record: vi.fn() };
  const events = { emit: vi.fn() };
  const svc = new MembersService(
    prisma as never,
    { invalidate: vi.fn(), invalidateWorkspace: vi.fn() } as never,
    {} as never,
    events as never,
    audit as never,
  );
  return { svc, audit, prisma, events };
}

describe('MembersService — đổi vai trò dự án phát access.changed (S-I6)', () => {
  it('setProjectRoles: đổi vai trò đang có VÀ tạo ghi đè mới đều phát access.changed cho người đó', async () => {
    const upd = setupProject({ hasOverride: true });
    await upd.svc.setProjectRoles('w1', 'p1', 'u2', ['pr1'], 'a');
    expect(upd.events.emit).toHaveBeenCalledWith('access.changed', {
      workspaceId: 'w1',
      userIds: ['u2'],
    });
    const created = setupProject({ hasOverride: false });
    await created.svc.setProjectRoles('w1', 'p1', 'u2', ['pr1'], 'a');
    expect(created.events.emit).toHaveBeenCalledWith('access.changed', {
      workspaceId: 'w1',
      userIds: ['u2'],
    });
  });
});

describe('MembersService — nhật ký dự án (M11)', () => {
  const setup = setupProject;
  const first = (audit: { record: { mock: { calls: unknown[][] } } }) =>
    audit.record.mock.calls[0]![0] as Record<string, unknown>;

  it('addProject / setProjectRoles (tạo ghi đè mới) từ chối tài khoản vô hiệu hoá hoặc automation', async () => {
    const a = setup({ hasOverride: false, userStatus: 'DEACTIVATED' });
    await expect(a.svc.addProject('w1', 'p1', 'u2', ['pr1'], 'a')).rejects.toThrow(/vô hiệu hoá/);
    await expect(a.svc.setProjectRoles('w1', 'p1', 'u2', ['pr1'], 'a')).rejects.toThrow(
      /vô hiệu hoá/,
    );
    expect(a.prisma.projectMembership.create).not.toHaveBeenCalled();
    const b = setup({ hasOverride: false, userEmail: 'automation@tirapro.local' });
    await expect(b.svc.addProject('w1', 'p1', 'u2', ['pr1'], 'a')).rejects.toThrow(
      /tài khoản hệ thống/,
    );
  });

  it('addProjectMany từ chối cả lô nếu có tài khoản vô hiệu hoá', async () => {
    const a = setup({ hasOverride: false, userStatus: 'DEACTIVATED' });
    (a.prisma.workspaceMembership as unknown as { findMany: unknown }).findMany = vi.fn(() =>
      Promise.resolve([{ userId: 'u2' }]),
    );
    (a.prisma.projectMembership as unknown as { findMany: unknown }).findMany = vi.fn(() =>
      Promise.resolve([]),
    );
    await expect(a.svc.addProjectMany('w1', 'p1', ['u2'], ['pr1'], 'a')).rejects.toThrow(
      /vô hiệu hoá/,
    );
    expect(a.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('setProjectRoles cho người chưa có ghi đè → "đặt vai trò riêng" (roles_changed), không phải "thêm vào dự án"', async () => {
    const { svc, audit } = setup({ hasOverride: false });
    await svc.setProjectRoles('w1', 'p1', 'u2', ['pr1'], 'a');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(first(audit)).toMatchObject({ action: 'project_member.roles_changed' });
    expect(String(first(audit).summary)).toContain('Đặt vai trò riêng');
  });

  it('addProject cho người chưa có ghi đè → project_member.added', async () => {
    const { svc, audit } = setup({ hasOverride: false });
    await svc.addProject('w1', 'p1', 'u2', ['pr1'], 'a');
    expect(first(audit)).toMatchObject({ action: 'project_member.added' });
  });

  it('clearProjectOverride: không có gì để gỡ → không ghi nhật ký', async () => {
    const { svc, audit } = setup({ hasOverride: false, deleteCount: 0 });
    await svc.clearProjectOverride('w1', 'p1', 'u2', 'a');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('clearProjectOverride: có gỡ → ghi project_member.removed', async () => {
    const { svc, audit } = setup({ hasOverride: true, deleteCount: 1 });
    await svc.clearProjectOverride('w1', 'p1', 'u2', 'a');
    expect(first(audit)).toMatchObject({ action: 'project_member.removed' });
  });
});

describe('MembersService — dự án riêng tư', () => {
  const userRow = (id: string) => ({
    id,
    email: `${id}@x.vn`,
    displayName: id,
    avatarUrl: null,
    timezone: 'UTC',
    locale: 'vi',
    status: 'ACTIVE',
    isSystemAdmin: false,
    lastSeenAt: null,
    createdAt: new Date(),
  });
  const role = { id: 'pr1', name: 'Project Admin', color: null };

  function setup(opts: { isPrivate: boolean; memberCount?: number }) {
    const wsRows = ['u1', 'u2', 'u3'].map((id) => ({
      id: `wm-${id}`,
      joinedAt: null,
      roleId: 'wr',
      role: { id: 'wr', name: 'Workspace Member', color: null },
      user: userRow(id),
      roles: [{ role: { id: 'wr', name: 'Workspace Member', color: null } }],
    }));
    const overrides = [
      { id: 'pm1', userId: 'u1', roleId: 'pr1', role, roles: [{ role }] },
      ...(opts.memberCount === 2
        ? [{ id: 'pm2', userId: 'u2', roleId: 'pr1', role, roles: [{ role }] }]
        : []),
    ];
    const prisma = {
      project: {
        findFirst: vi.fn(() =>
          Promise.resolve({ id: 'p1', name: 'Demo', isPrivate: opts.isPrivate }),
        ),
      },
      workspaceMembership: { findMany: vi.fn(() => Promise.resolve(wsRows)) },
      projectMembership: {
        findMany: vi.fn(() => Promise.resolve(overrides)),
        count: vi.fn(() => Promise.resolve(overrides.length)),
        findUnique: vi.fn(() => Promise.resolve({ id: 'pm1' })),
        deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      role: { findMany: vi.fn(() => Promise.resolve([role])) },
      user: { findUnique: vi.fn(() => Promise.resolve({ displayName: 'x', email: 'x@x.vn' })) },
    };
    const audit = { record: vi.fn() };
    const events = { emit: vi.fn() };
    const rbac = { invalidate: vi.fn() };
    const svc = new MembersService(
      prisma as never,
      rbac as never,
      {} as never,
      events as never,
      audit as never,
    );
    return { svc, prisma, audit, events };
  }

  it('listProject: dự án riêng tư chỉ trả người có ProjectMembership (isOverride)', async () => {
    const { svc } = setup({ isPrivate: true });
    const out = await svc.listProject('w1', 'p1');
    expect(out.map((m) => m.user.id)).toEqual(['u1']);
    expect(out.every((m) => m.isOverride)).toBe(true);
  });

  it('listProject: dự án công khai vẫn trả toàn bộ thành viên workspace', async () => {
    const { svc } = setup({ isPrivate: false });
    const out = await svc.listProject('w1', 'p1');
    expect(out.map((m) => m.user.id)).toEqual(['u1', 'u2', 'u3']);
  });

  it('clearProjectOverride: dự án riêng tư, thành viên duy nhất => BusinessRuleException, không xoá', async () => {
    const { svc, prisma } = setup({ isPrivate: true });
    await expect(svc.clearProjectOverride('w1', 'p1', 'u1', 'a')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('ít nhất một thành viên') as unknown,
    });
    expect(prisma.projectMembership.deleteMany).not.toHaveBeenCalled();
  });

  it('clearProjectOverride: dự án riêng tư còn người khác => gỡ khỏi dự án + nhật ký', async () => {
    const { svc, prisma, audit } = setup({ isPrivate: true, memberCount: 2 });
    await svc.clearProjectOverride('w1', 'p1', 'u1', 'a');
    expect(prisma.projectMembership.deleteMany).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project_member.removed' }),
    );
  });

  it('clearProjectOverride: dự án công khai => như cũ (không kiểm thành viên cuối)', async () => {
    const { svc, prisma } = setup({ isPrivate: false });
    await svc.clearProjectOverride('w1', 'p1', 'u1', 'a');
    expect(prisma.projectMembership.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe('MembersService.clearProjectOverride — phát sự kiện rút socket (P16)', () => {
  function build(deleteCount: number) {
    const prisma = {
      project: {
        findFirst: vi.fn(() => Promise.resolve({ id: 'p1', name: 'Demo', isPrivate: true })),
      },
      projectMembership: {
        count: vi.fn(() => Promise.resolve(2)),
        findUnique: vi.fn(() => Promise.resolve({ id: 'pm1' })),
        deleteMany: vi.fn(() => Promise.resolve({ count: deleteCount })),
      },
      user: { findUnique: vi.fn(() => Promise.resolve({ displayName: 'x', email: 'x@x.vn' })) },
    };
    const events = { emit: vi.fn() };
    const svc = new MembersService(
      prisma as never,
      { invalidate: vi.fn() } as never,
      {} as never,
      events as never,
      { record: vi.fn() } as never,
    );
    return { svc, events };
  }

  it('gỡ khỏi dự án -> phát project.member_removed {workspaceId, projectId, userId} SAU khi xoá', async () => {
    const { svc, events } = build(1);
    await svc.clearProjectOverride('w1', 'p1', 'u2', 'a');
    expect(events.emit).toHaveBeenCalledWith('project.member_removed', {
      workspaceId: 'w1',
      projectId: 'p1',
      userId: 'u2',
    });
  });

  it('không có gì để gỡ (count 0) -> không phát sự kiện', async () => {
    const { svc, events } = build(0);
    await svc.clearProjectOverride('w1', 'p1', 'u2', 'a');
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('MembersService — phát member.added SAU commit (L28)', () => {
  const memberRow = {
    id: 'm2',
    joinedAt: new Date(),
    roleId: 'r1',
    role: { id: 'r1', name: 'Workspace Member', color: null },
    user: {
      id: 'u2',
      email: 'ba@x.vn',
      displayName: 'Bình',
      avatarUrl: null,
      timezone: 'UTC',
      locale: 'vi',
      status: 'ACTIVE',
      isSystemAdmin: false,
      lastSeenAt: null,
      createdAt: new Date(),
    },
    roles: [{ role: { id: 'r1', name: 'Workspace Member', color: null } }],
  };

  function setup(opts: { existing?: boolean } = {}) {
    const order: string[] = [];
    const tx = {
      user: { create: vi.fn(() => Promise.resolve({ id: 'u9' })) },
      workspaceMembership: {
        create: vi.fn(() => Promise.resolve({ id: 'm9' })),
        createMany: vi.fn(() => Promise.resolve({ count: 2 })),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      workspaceMembershipRole: { createMany: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: unknown) => {
        order.push('commit');
        return typeof fn === 'function' ? await (fn as (t: unknown) => unknown)(tx) : [];
      }),
      user: {
        findUnique: vi.fn((a: { where: { email?: string } }) =>
          Promise.resolve(a.where.email ? null : { id: 'u2', email: 'ba@x.vn', status: 'ACTIVE' }),
        ),
        findMany: vi.fn(() =>
          Promise.resolve([
            { id: 'u1', status: 'ACTIVE', email: 'a@x.vn' },
            { id: 'u2', status: 'ACTIVE', email: 'b@x.vn' },
          ]),
        ),
      },
      role: { findMany: vi.fn(() => Promise.resolve([{ id: 'r1' }])) },
      workspaceMembership: {
        findUnique: vi.fn(() => Promise.resolve(opts.existing ? { id: 'm2' } : null)),
        findMany: vi.fn(() => Promise.resolve([])),
        create: vi.fn(() => {
          order.push('commit');
          return Promise.resolve({});
        }),
        update: vi.fn(() => Promise.resolve({})),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(memberRow)),
      },
      workspaceMembershipRole: {
        deleteMany: vi.fn(() => Promise.resolve({})),
        createMany: vi.fn(() => Promise.resolve({})),
      },
    };
    const events = {
      emit: vi.fn((name: string) => {
        order.push(`emit:${name}`);
      }),
    };
    const svc = new MembersService(
      prisma as never,
      { invalidate: vi.fn(), invalidateWorkspace: vi.fn() } as never,
      {} as never,
      events as never,
      { record: vi.fn() } as never,
    );
    return { svc, events, order };
  }
  const added = (events: { emit: { mock: { calls: unknown[][] } } }) =>
    events.emit.mock.calls.filter((c) => c[0] === 'member.added');

  it('addWorkspace (nhánh tạo mới): phát member.added với đúng userIds + actorId, sau khi tạo membership', async () => {
    const { svc, events, order } = setup();
    await svc.addWorkspace('w1', 'u2', ['r1'], 'actor');
    expect(added(events)).toEqual([
      ['member.added', { workspaceId: 'w1', userIds: ['u2'], actorId: 'actor' }],
    ]);
    expect(order.indexOf('emit:member.added')).toBeGreaterThan(order.indexOf('commit'));
  });

  it('addWorkspace (đã là thành viên → 409): KHÔNG phát member.added', async () => {
    const { svc, events } = setup({ existing: true });
    await expect(svc.addWorkspace('w1', 'u2', ['r1'], 'actor')).rejects.toMatchObject({
      status: 409,
    });
    expect(added(events)).toHaveLength(0);
  });

  it('addWorkspaceMany: phát một lần với những người THỰC SỰ được thêm, sau transaction', async () => {
    const { svc, events, order } = setup();
    const res = await svc.addWorkspaceMany('w1', ['u1', 'u2'], ['r1'], 'actor');
    expect(res.added).toBe(2);
    expect(added(events)).toEqual([
      ['member.added', { workspaceId: 'w1', userIds: ['u1', 'u2'], actorId: 'actor' }],
    ]);
    expect(order.indexOf('emit:member.added')).toBeGreaterThan(order.indexOf('commit'));
  });

  it('addWorkspaceMany: không ai cần thêm → không phát', async () => {
    const { svc, events } = setup();
    // mọi người đã là thành viên
    (
      svc as unknown as { prisma: { workspaceMembership: { findMany: unknown } } }
    ).prisma.workspaceMembership.findMany = vi.fn(() =>
      Promise.resolve([{ userId: 'u1' }, { userId: 'u2' }]),
    );
    const res = await svc.addWorkspaceMany('w1', ['u1', 'u2'], ['r1'], 'actor');
    expect(res.added).toBe(0);
    expect(added(events)).toHaveLength(0);
  });

  it('createAccount: phát member.added cho tài khoản vừa tạo, sau transaction', async () => {
    const { svc, events, order } = setup();
    await svc.createAccount('w1', 'actor', {
      email: 'new@x.vn',
      displayName: 'Mới',
      roleIds: ['r1'],
    });
    expect(added(events)).toEqual([
      ['member.added', { workspaceId: 'w1', userIds: ['u9'], actorId: 'actor' }],
    ]);
    expect(order.indexOf('emit:member.added')).toBeGreaterThan(order.indexOf('commit'));
  });
});

describe('MembersService — thử gán lại việc Jira khi được thêm vào dự án (L28 fix)', () => {
  const setup = setupProject;
  it('addProject (mới) phát project.access_changed {projectId, userIds} để thử lại việc Jira đang chờ; người đã ở dự án thì không', async () => {
    const a = setup({ hasOverride: false });
    await a.svc.addProject('w1', 'p1', 'u2', ['pr1'], 'actor');
    expect(a.events.emit).toHaveBeenCalledWith('project.access_changed', {
      workspaceId: 'w1',
      projectId: 'p1',
      userIds: ['u2'],
      actorId: 'actor',
    });
    const b = setup({ hasOverride: true });
    await b.svc.addProject('w1', 'p1', 'u2', ['pr1'], 'actor'); // đã ở dự án → chỉ đổi vai trò
    expect(b.events.emit).not.toHaveBeenCalledWith('project.access_changed', expect.anything());
  });

  it('setProjectRoles tạo ghi đè mới (người vào dự án) phát project.access_changed; đổi vai trò người đã có thì không', async () => {
    const a = setup({ hasOverride: false });
    await a.svc.setProjectRoles('w1', 'p1', 'u2', ['pr1'], 'actor');
    expect(a.events.emit).toHaveBeenCalledWith(
      'project.access_changed',
      expect.objectContaining({ projectId: 'p1', userIds: ['u2'] }),
    );
    const b = setup({ hasOverride: true });
    await b.svc.setProjectRoles('w1', 'p1', 'u2', ['pr1'], 'actor');
    expect(b.events.emit).not.toHaveBeenCalledWith('project.access_changed', expect.anything());
  });

  it('addProjectMany phát một lần với những người thực sự được thêm; không ai mới thì không phát', async () => {
    const a = setup({ hasOverride: false });
    (a.prisma.workspaceMembership as unknown as { findMany: unknown }).findMany = vi.fn(() =>
      Promise.resolve([{ userId: 'u2' }]),
    );
    (a.prisma.projectMembership as unknown as { findMany: unknown }).findMany = vi.fn(() =>
      Promise.resolve([]),
    );
    await a.svc.addProjectMany('w1', 'p1', ['u2'], ['pr1'], 'actor');
    expect(a.events.emit).toHaveBeenCalledWith('project.access_changed', {
      workspaceId: 'w1',
      projectId: 'p1',
      userIds: ['u2'],
      actorId: 'actor',
    });
    const b = setup({ hasOverride: false });
    (b.prisma.workspaceMembership as unknown as { findMany: unknown }).findMany = vi.fn(() =>
      Promise.resolve([{ userId: 'u2' }]),
    );
    (b.prisma.projectMembership as unknown as { findMany: unknown }).findMany = vi.fn(() =>
      Promise.resolve([{ userId: 'u2' }]),
    );
    await b.svc.addProjectMany('w1', 'p1', ['u2'], ['pr1'], 'actor');
    expect(b.events.emit).not.toHaveBeenCalledWith('project.access_changed', expect.anything());
  });
});

describe('MembersService.listWorkspace/listProject — lastSeenAt/isSystemAdmin chỉ cho member:manage (S-minor)', () => {
  const userRow = {
    id: 'u1',
    email: 'a@x.vn',
    displayName: 'An',
    avatarUrl: null,
    timezone: 'UTC',
    locale: 'vi',
    status: 'ACTIVE',
    isSystemAdmin: true,
    lastSeenAt: new Date('2026-10-16T01:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'),
  };
  const wsRow = {
    id: 'm1',
    joinedAt: null,
    roleId: 'r1',
    role: { id: 'r1', name: 'Workspace Member', color: null },
    user: userRow,
    roles: [{ role: { id: 'r1', name: 'Workspace Member', color: null } }],
  };
  function setup() {
    const prisma = {
      workspaceMembership: { findMany: vi.fn(() => Promise.resolve([wsRow])) },
      projectMembership: { findMany: vi.fn(() => Promise.resolve([])) },
      project: {
        findFirst: vi.fn(() => Promise.resolve({ id: 'p1', name: 'Demo', isPrivate: false })),
      },
      role: { findMany: vi.fn(() => Promise.resolve([])) },
    };
    return new MembersService(prisma as never, {} as never, {} as never, {} as never, {} as never);
  }
  const plain = { id: 'v', permissions: ['workspace:view'] };
  const manager = { id: 'v', permissions: ['member:manage'] };

  it('workspace: người xem thường nhận bản rút gọn; member:manage / admin hệ thống / nội bộ (không viewer) nhận đủ', async () => {
    const svc = setup();
    const [a] = await svc.listWorkspace('w1', plain);
    expect(a!.user).not.toHaveProperty('isSystemAdmin');
    expect(a!.user).not.toHaveProperty('lastSeenAt');
    expect((await svc.listWorkspace('w1', manager))[0]!.user).toMatchObject({
      isSystemAdmin: true,
      lastSeenAt: '2026-10-16T01:00:00.000Z',
    });
    expect(
      (await svc.listWorkspace('w1', { id: 'v', isSystemAdmin: true }))[0]!.user,
    ).toHaveProperty('lastSeenAt');
    expect((await svc.listWorkspace('w1'))[0]!.user).toHaveProperty('lastSeenAt');
  });

  it('dự án: cùng quy tắc', async () => {
    const svc = setup();
    expect((await svc.listProject('w1', 'p1', plain))[0]!.user).not.toHaveProperty('lastSeenAt');
    expect((await svc.listProject('w1', 'p1', manager))[0]!.user).toHaveProperty('lastSeenAt');
  });
});
