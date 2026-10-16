import { describe, expect, it, vi } from 'vitest';
import { RolesService } from './roles.service';

describe('RolesService — đếm thành viên theo workspace', () => {
  it('list(): memberCount đếm theo workspace hiện tại, không đếm toàn hệ thống', async () => {
    const prisma = { role: { findMany: vi.fn(() => Promise.resolve([])) } };
    const svc = new RolesService(prisma as never, {} as never, { record: vi.fn() } as never);
    await svc.list('w1');
    const select = (prisma.role.findMany.mock.calls[0] as unknown[])[0] as {
      select: { _count: { select: Record<string, unknown> } };
    };
    expect(select.select._count.select.wsMembershipRoles).toEqual({
      where: { membership: { workspaceId: 'w1' } },
    });
    expect(select.select._count.select.projMembershipRoles).toEqual({
      where: { membership: { project: { workspaceId: 'w1', deletedAt: null } } },
    });
  });

  it('remove(): kiểm tra số người đang giữ vai trò cũng lọc theo workspace', async () => {
    const prisma = {
      role: {
        findUnique: vi.fn(() =>
          Promise.resolve({
            id: 'r1',
            isSystem: false,
            workspaceId: 'w1',
            _count: { wsMembershipRoles: 0, projMembershipRoles: 0 },
          }),
        ),
        delete: vi.fn(() => Promise.resolve({})),
      },
    };
    const svc = new RolesService(
      prisma as never,
      { invalidateWorkspace: vi.fn() } as never,
      { record: vi.fn() } as never,
    );
    await svc.remove('w1', 'r1', 'u1');
    const arg = (prisma.role.findUnique.mock.calls[0] as unknown[])[0] as {
      select: { _count: { select: Record<string, unknown> } };
    };
    expect(arg.select._count.select.wsMembershipRoles).toEqual({
      where: { membership: { workspaceId: 'w1' } },
    });
  });
});

describe('RolesService — ghi nhật ký quản trị', () => {
  const roleRow = {
    id: 'r9',
    workspaceId: 'w1',
    name: 'QA',
    scope: 'PROJECT',
    isSystem: false,
    description: null,
    color: null,
    permissions: [{ permission: { key: 'issue:view' } }],
    _count: { wsMembershipRoles: 0, projMembershipRoles: 0 },
  };
  function setup() {
    const prisma = {
      role: {
        create: vi.fn(() => Promise.resolve(roleRow)),
        update: vi.fn(() => Promise.resolve(roleRow)),
        delete: vi.fn(() => Promise.resolve({})),
        findUnique: vi.fn(() =>
          Promise.resolve({
            id: 'r9',
            name: 'QA',
            isSystem: false,
            workspaceId: 'w1',
            _count: { wsMembershipRoles: 0, projMembershipRoles: 0 },
          }),
        ),
      },
      permission: { findMany: vi.fn(() => Promise.resolve([{ id: 'p1' }])) },
      rolePermission: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
      // dạng mảng (xoá bộ quyền cũ + ghi vai trò cùng một transaction): trả kết quả từng lệnh
      $transaction: vi.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
    };
    const audit = { record: vi.fn() };
    const rbac = { invalidateWorkspace: vi.fn() };
    const events = { emit: vi.fn() };
    const svc = new RolesService(prisma as never, rbac as never, audit as never, events as never);
    return { svc, audit, prisma, events };
  }

  function recorded(audit: { record: { mock: { calls: unknown[][] } } }) {
    return audit.record.mock.calls[0]![0] as Record<string, unknown>;
  }

  it('create(): ghi role.created kèm workspace + người thực hiện', async () => {
    const { svc, audit } = setup();
    await svc.create(
      'w1',
      { name: 'QA', scope: 'PROJECT', permissionKeys: ['issue:view'] } as never,
      'u1',
    );
    expect(recorded(audit)).toMatchObject({
      workspaceId: 'w1',
      actorId: 'u1',
      action: 'role.created',
      entityType: 'role',
      entityId: 'r9',
      summary: 'Tạo vai trò "QA"',
    });
  });

  it('update(): ghi role.updated', async () => {
    const { svc, audit } = setup();
    await svc.update('w1', 'r9', { name: 'QA 2' }, 'u1');
    expect(recorded(audit)).toMatchObject({
      workspaceId: 'w1',
      actorId: 'u1',
      action: 'role.updated',
      entityId: 'r9',
    });
  });

  it('update(bộ quyền): xoá quyền cũ + ghi vai trò trong MỘT transaction và phát access.changed cả workspace (S-I6)', async () => {
    const { svc, prisma, events } = setup();
    await svc.update('w1', 'r9', { permissionKeys: ['issue:view'] }, 'u1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = prisma.$transaction.mock.calls[0]![0];
    expect(ops).toHaveLength(2);
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r9' } });
    expect(prisma.role.update).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('access.changed', { workspaceId: 'w1' });
  });

  it('update(chỉ đổi tên/màu): không xoá quyền, không transaction, không phát access.changed', async () => {
    const { svc, prisma, events } = setup();
    await svc.update('w1', 'r9', { name: 'QA 2' }, 'u1');
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('update(bộ quyền): ghi vai trò lỗi (vd tên trùng) thì KHÔNG để vai trò mất sạch quyền — lỗi lan ra, không xoá riêng lẻ', async () => {
    const { svc, prisma } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Error('unique'));
    await expect(
      svc.update('w1', 'r9', { name: 'Trùng', permissionKeys: ['issue:view'] }, 'u1'),
    ).rejects.toThrow('unique');
  });

  it('remove(): ghi role.deleted với tên vai trò', async () => {
    const { svc, audit } = setup();
    await svc.remove('w1', 'r9', 'u1');
    expect(recorded(audit)).toMatchObject({
      workspaceId: 'w1',
      actorId: 'u1',
      action: 'role.deleted',
      summary: 'Xoá vai trò "QA"',
    });
  });
});
