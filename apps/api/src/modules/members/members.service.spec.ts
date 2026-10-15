import { describe, expect, it, vi } from 'vitest';
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
    };
    const rbac = { invalidate: vi.fn(() => Promise.resolve()) };
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

  function setup(opts: { existing?: boolean } = {}) {
    const prisma = {
      user: {
        findUnique: vi.fn(() =>
          Promise.resolve({ id: 'u2', displayName: 'Bình', email: 'ba@x.vn' }),
        ),
      },
      role: { findMany: vi.fn(() => Promise.resolve([{ id: 'r1' }])) },
      workspaceMembership: {
        findUnique: vi.fn(() => Promise.resolve(opts.existing ? { id: 'm2' } : null)),
        create: vi.fn(() => Promise.resolve({})),
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
    const svc = new MembersService(
      prisma as never,
      { invalidate: vi.fn() } as never,
      {} as never,
      { emit: vi.fn() } as never,
      audit as never,
    );
    return { svc, audit };
  }
  const first = (audit: { record: { mock: { calls: unknown[][] } } }) =>
    audit.record.mock.calls[0]![0] as Record<string, unknown>;

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

  it('addWorkspace(): đã là thành viên → chỉ ghi member.roles_changed (không ghi đôi)', async () => {
    const { svc, audit } = setup({ existing: true });
    await svc.addWorkspace('w1', 'u2', ['r1'], 'actor');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(first(audit)).toMatchObject({ action: 'member.roles_changed', actorId: 'actor' });
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

describe('MembersService — nhật ký dự án (M11)', () => {
  function setup(opts: {
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
    const svc = new MembersService(
      prisma as never,
      { invalidate: vi.fn() } as never,
      {} as never,
      { emit: vi.fn() } as never,
      audit as never,
    );
    return { svc, audit, prisma };
  }
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
