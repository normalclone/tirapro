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
    };
    const audit = { record: vi.fn() };
    const rbac = { invalidateWorkspace: vi.fn() };
    const svc = new RolesService(prisma as never, rbac as never, audit as never);
    return { svc, audit };
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
