import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { AdminService } from './admin.service';

/** `expect.any(Date)` có kiểu `any` → ép kiểu một lần để không dính no-unsafe-assignment. */
const anyDate = expect.any(Date) as unknown as Date;
const anyString = expect.any(String) as unknown as string;
/** `expect.objectContaining` lồng trong object khác — cùng lý do ép kiểu. */
const contain = (o: Record<string, unknown>) =>
  expect.objectContaining(o) as unknown as Record<string, unknown>;

function setup(status = 'ACTIVE') {
  const updated = {
    id: 'u1',
    email: 'a@x.vn',
    displayName: 'An',
    avatarUrl: null,
    status: 'DEACTIVATED',
    isSystemAdmin: false,
    canCreateWorkspace: false,
    lastSeenAt: null,
    createdAt: new Date(),
    _count: { workspaceMemberships: 1 },
  };
  const prisma = {
    user: {
      findUnique: vi.fn((args: { where: { id?: string; email?: string } }) =>
        args.where.email
          ? Promise.resolve(null)
          : Promise.resolve({
              id: 'u1',
              status,
              displayName: 'An',
              email: 'a@x.vn',
              isSystemAdmin: false,
              canCreateWorkspace: false,
            }),
      ),
      update: vi.fn(() => Promise.resolve(updated)),
      create: vi.fn(() => Promise.resolve({ ...updated, isSystemAdmin: true })),
      count: vi.fn(() => Promise.resolve(2)),
    },
    refreshToken: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(prisma))),
  };
  const audit = { record: vi.fn() };
  return {
    service: new AdminService(prisma as never, audit as never, {} as never),
    audit,
  };
}

describe('AdminService.update — nhật ký khoá/mở khoá', () => {
  it('đổi ACTIVE → DEACTIVATED ghi account.deactivated', async () => {
    const { service, audit } = setup('ACTIVE');
    await service.update('u1', { status: 'DEACTIVATED' }, 'admin');
    expect(audit.record.mock.calls[0]![0]).toMatchObject({
      actorId: 'admin',
      action: 'account.deactivated',
      entityId: 'u1',
      summary: 'Khoá tài khoản An (a@x.vn)',
    });
  });

  it('đổi DEACTIVATED → ACTIVE ghi account.reactivated', async () => {
    const { service, audit } = setup('DEACTIVATED');
    await service.update('u1', { status: 'ACTIVE' }, 'admin');
    expect(audit.record.mock.calls[0]![0]).toMatchObject({ action: 'account.reactivated' });
  });

  it('không đổi trạng thái thì không ghi', async () => {
    const { service, audit } = setup('ACTIVE');
    await service.update('u1', { displayName: 'An B' }, 'admin');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('đổi isSystemAdmin / canCreateWorkspace ghi account.permissions_changed', async () => {
    const { service, audit } = setup('ACTIVE');
    await service.update('u1', { isSystemAdmin: true, canCreateWorkspace: true }, 'admin');
    const entry = audit.record.mock.calls[0]![0] as { action: string; summary: string };
    expect(entry.action).toBe('account.permissions_changed');
    expect(entry.summary).toContain('cấp quyền admin hệ thống');
    expect(entry.summary).toContain('cho phép lập không gian làm việc');
  });

  it('create(): ghi account.created, không đưa mật khẩu vào nhật ký', async () => {
    const { service, audit } = setup('ACTIVE');
    const out = await service.create(
      { email: 'a@x.vn', displayName: 'An', isSystemAdmin: true },
      'admin',
    );
    const entry = audit.record.mock.calls[0]![0] as { action: string; summary: string };
    expect(entry.action).toBe('account.created');
    expect(entry.summary).toContain('admin hệ thống');
    expect(JSON.stringify(entry)).not.toContain(out.tempPassword!);
  });
});

function make(
  user: Record<string, unknown> = {
    id: 'u2',
    email: 'dev@x.vn',
    displayName: 'Dũng',
    status: 'ACTIVE',
    isSystemAdmin: false,
    passwordHash: 'H',
  },
) {
  const tx = {
    user: { update: vi.fn(() => Promise.resolve({ id: 'u2' })) },
    refreshToken: { updateMany: vi.fn(() => Promise.resolve({ count: 3 })) },
  };
  const prisma = {
    user: {
      findUnique: vi.fn(() => Promise.resolve(user)),
      count: vi.fn(() => Promise.resolve(2)),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    workspace: { findFirst: vi.fn(() => Promise.resolve({ id: 'w2', name: 'Công ty Demo' })) },
    workspaceMembership: { findUnique: vi.fn(() => Promise.resolve(null)) },
    role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-member' })) },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };
  const audit = { record: vi.fn() };
  const members = { addWorkspace: vi.fn(() => Promise.resolve({ membershipId: 'm1' })) };
  return {
    svc: new AdminService(prisma as never, audit as never, members as never),
    tx,
    prisma,
    audit,
    members,
  };
}

describe('AdminService — vòng đời tài khoản', () => {
  it('vô hiệu hoá: đặt status + sessionsRevokedAt và thu hồi mọi refresh token trong một transaction', async () => {
    const { svc, tx, audit } = make();
    await svc.setStatus('admin1', 'u2', 'DEACTIVATED');
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u2' },
        data: contain({
          status: 'DEACTIVATED',
          sessionsRevokedAt: anyDate,
        }),
      }),
    );
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u2', revokedAt: null },
      data: { revokedAt: anyDate },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'account.deactivated',
        workspaceId: null,
        actorId: 'admin1',
      }),
    );
  });

  it('kích hoạt lại: chỉ đổi status, không thu hồi gì thêm', async () => {
    const { svc, tx, audit } = make({
      id: 'u2',
      email: 'dev@x.vn',
      displayName: 'Dũng',
      status: 'DEACTIVATED',
      isSystemAdmin: false,
      passwordHash: 'H',
    });
    await svc.setStatus('admin1', 'u2', 'ACTIVE');
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } }),
    );
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'account.reactivated' }),
    );
  });

  it('không cho khoá chính mình', async () => {
    const { svc } = make({
      id: 'admin1',
      email: 'a@x.vn',
      displayName: 'A',
      status: 'ACTIVE',
      isSystemAdmin: true,
      passwordHash: 'H',
    });
    await expect(svc.setStatus('admin1', 'admin1', 'DEACTIVATED')).rejects.toThrow(/chính mình/);
  });

  it('không cho khoá admin hệ thống cuối cùng', async () => {
    const { svc, prisma } = make({
      id: 'u3',
      email: 'b@x.vn',
      displayName: 'B',
      status: 'ACTIVE',
      isSystemAdmin: true,
      passwordHash: 'H',
    });
    prisma.user.count.mockResolvedValue(1);
    await expect(svc.setStatus('admin1', 'u3', 'DEACTIVATED')).rejects.toThrow(/cuối cùng/);
  });

  it('không cho khoá tài khoản hệ thống automation', async () => {
    const { svc } = make({
      id: 'sys',
      email: 'automation@tirapro.local',
      displayName: 'Automation',
      status: 'ACTIVE',
      isSystemAdmin: false,
      passwordHash: null,
    });
    await expect(svc.setStatus('admin1', 'sys', 'DEACTIVATED')).rejects.toThrow();
  });

  it('update(): lỗi khoá không làm các trường khác bị ghi dở', async () => {
    const { svc, prisma, tx } = make({
      id: 'admin1',
      email: 'a@x.vn',
      displayName: 'A',
      status: 'ACTIVE',
      isSystemAdmin: true,
      canCreateWorkspace: false,
      passwordHash: 'H',
    });
    await expect(
      svc.update('admin1', { displayName: 'Khác', status: 'DEACTIVATED' }, 'admin1'),
    ).rejects.toThrow(/chính mình/);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('đặt lại mật khẩu: trả mật khẩu tạm thoả chính sách, đổi hash, thu hồi phiên', async () => {
    const { svc, tx, audit } = make();
    const out = await svc.resetPassword('admin1', 'u2');
    expect(out.tempPassword).toMatch(/[A-Z]/);
    expect(out.tempPassword).toMatch(/[a-z]/);
    expect(out.tempPassword).toMatch(/[0-9]/);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: contain({
          passwordHash: anyString,
          sessionsRevokedAt: anyDate,
        }),
      }),
    );
    expect(tx.refreshToken.updateMany).toHaveBeenCalled();
    const entry = audit.record.mock.calls[0]![0] as { action: string };
    expect(entry.action).toBe('account.password_reset');
    expect(JSON.stringify(audit.record.mock.calls[0]![0])).not.toContain(out.tempPassword);
  });

  it('không đặt lại mật khẩu của tài khoản hệ thống automation', async () => {
    const { svc } = make({
      id: 'sys',
      email: 'automation@tirapro.local',
      displayName: 'Automation',
      status: 'ACTIVE',
      isSystemAdmin: false,
      passwordHash: null,
    });
    await expect(svc.resetPassword('admin1', 'sys')).rejects.toThrow();
  });

  it('đăng xuất mọi thiết bị: đặt mốc thu hồi, thu hồi refresh token, trả số lượng', async () => {
    const { svc, tx, audit } = make();
    const out = await svc.revokeSessions('admin1', 'u2');
    expect(out).toEqual({ revoked: 3 });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { sessionsRevokedAt: anyDate } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'account.sessions_revoked', workspaceId: null }),
    );
  });

  it('list(): tìm theo tên/email không phân biệt hoa thường + lọc trạng thái', async () => {
    const { svc, prisma } = make();
    await svc.list({ search: 'Bình', status: 'DEACTIVATED' });
    const where = (
      prisma.user.findMany.mock.calls[0] as unknown as [{ where: { AND: unknown[] } }]
    )[0].where;
    expect(JSON.stringify(where)).toContain('Bình');
    expect(JSON.stringify(where)).toContain('insensitive');
    expect(where.AND).toContainEqual({ status: 'DEACTIVATED' });
  });
});

describe('AdminService.addToWorkspace — gán tài khoản vào không gian làm việc', () => {
  it('không chỉ định vai trò -> dùng vai trò hệ thống Workspace Member, ghi account.workspace_added', async () => {
    const { svc, members, audit, prisma } = make();
    await svc.addToWorkspace('admin1', 'u2', { workspaceId: 'w2' });
    expect(members.addWorkspace).toHaveBeenCalledWith('w2', 'u2', ['r-member'], 'admin1');
    expect(prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: contain({ name: 'Workspace Member', isSystem: true }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'account.workspace_added',
        workspaceId: null,
        actorId: 'admin1',
        entityId: 'u2',
      }),
    );
  });

  it('có chỉ định vai trò -> giữ nguyên danh sách, không tra vai trò mặc định', async () => {
    const { svc, members, prisma } = make();
    await svc.addToWorkspace('admin1', 'u2', { workspaceId: 'w2', roleIds: ['r1', 'r2'] });
    expect(members.addWorkspace).toHaveBeenCalledWith('w2', 'u2', ['r1', 'r2'], 'admin1');
    expect(prisma.role.findFirst).not.toHaveBeenCalled();
  });

  it('không gian làm việc không tồn tại / đã lưu trữ -> NotFoundAppException', async () => {
    const { svc, prisma, members } = make();
    prisma.workspace.findFirst.mockResolvedValue(null as never);
    await expect(svc.addToWorkspace('admin1', 'u2', { workspaceId: 'zz' })).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
    expect(prisma.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'zz', deletedAt: null } }),
    );
    expect(members.addWorkspace).not.toHaveBeenCalled();
  });

  it('đã là thành viên -> từ chối, không ghi đè vai trò', async () => {
    const { svc, prisma, members } = make();
    prisma.workspaceMembership.findUnique.mockResolvedValue({ id: 'm9' } as never);
    await expect(svc.addToWorkspace('admin1', 'u2', { workspaceId: 'w2' })).rejects.toThrow(
      /đã thuộc/,
    );
    expect(members.addWorkspace).not.toHaveBeenCalled();
  });
});
