import { DOMAIN_EVENTS } from '@tirapro/types';
import { describe, expect, it, vi } from 'vitest';
import {
  ConflictAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { updateRoleSchema } from './roles.schemas';
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

const UPDATED_AT = new Date('2026-10-20T03:00:00.000Z');
const roleRow = {
  id: 'r9',
  workspaceId: 'w1',
  name: 'QA',
  scope: 'PROJECT',
  isSystem: false,
  description: null,
  color: null,
  updatedAt: UPDATED_AT,
  permissions: [{ permission: { key: 'issue:view' } }],
  _count: { wsMembershipRoles: 0, projMembershipRoles: 0 },
};
function setup() {
  const calls: string[] = [];
  const prisma = {
    role: {
      create: vi.fn(() => Promise.resolve(roleRow)),
      update: vi.fn(() => Promise.resolve(roleRow)),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
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
    rolePermission: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      count: vi.fn(() => Promise.resolve(0)),
    },
    workspaceMembership: { count: vi.fn(() => Promise.resolve(1)) },
    // Interactive transaction: callback chạy với chính mock làm `tx`; ghi mốc "commit" để kiểm thứ tự sự kiện.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const out = await fn(prisma);
      calls.push('commit');
      return out;
    }),
  };
  const audit = { record: vi.fn() };
  const rbac = {
    invalidateWorkspace: vi.fn(() => {
      calls.push('invalidate');
      return Promise.resolve();
    }),
  };
  const events = {
    emit: vi.fn(() => {
      calls.push('emit');
      return true;
    }),
  };
  const svc = new RolesService(prisma as never, rbac as never, audit as never, events as never);
  return { svc, audit, prisma, events, rbac, calls };
}

function recorded(audit: { record: { mock: { calls: unknown[][] } } }) {
  return audit.record.mock.calls[0]![0] as Record<string, unknown>;
}

describe('RolesService — ghi nhật ký quản trị', () => {
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

describe('RolesService — cập nhật bộ quyền', () => {
  it('update(bộ quyền): xoá quyền cũ + ghi vai trò trong MỘT transaction và phát access.changed cả workspace (S-I6)', async () => {
    const { svc, prisma, events } = setup();
    await svc.update('w1', 'r9', { permissionKeys: ['issue:view'] }, 'u1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r9' } });
    expect(prisma.role.update).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('access.changed', { workspaceId: 'w1' });
  });

  it('update(bộ quyền): PATCH làm mới RBAC cả workspace và phát ACCESS_CHANGED — SAU khi transaction commit (184)', async () => {
    const { svc, rbac, events, calls } = setup();
    await svc.update('w1', 'r9', { permissionKeys: ['issue:view'] }, 'u1');
    expect(rbac.invalidateWorkspace).toHaveBeenCalledWith('w1');
    expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.ACCESS_CHANGED, { workspaceId: 'w1' });
    expect(calls).toEqual(['commit', 'invalidate', 'emit']);
  });

  it('update(chỉ đổi tên/màu): không xoá quyền, không phát access.changed', async () => {
    const { svc, prisma, events } = setup();
    await svc.update('w1', 'r9', { name: 'QA 2' }, 'u1');
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('update(bộ quyền): ghi vai trò lỗi (vd tên trùng) thì KHÔNG để vai trò mất sạch quyền — lỗi lan ra, không phát sự kiện', async () => {
    const { svc, prisma, events, rbac } = setup();
    prisma.role.update.mockRejectedValueOnce(new Error('unique'));
    await expect(
      svc.update('w1', 'r9', { name: 'Trùng', permissionKeys: ['issue:view'] }, 'u1'),
    ).rejects.toThrow('unique');
    expect(events.emit).not.toHaveBeenCalled();
    expect(rbac.invalidateWorkspace).not.toHaveBeenCalled();
  });

  it('update(): luôn đóng dấu updatedAt (Prisma không tự đóng khi chỉ ghi quan hệ lồng)', async () => {
    const { svc, prisma } = setup();
    await svc.update('w1', 'r9', { permissionKeys: ['issue:view'] }, 'u1');
    const arg = (prisma.role.update.mock.calls[0] as unknown[])[0] as {
      data: { updatedAt?: unknown };
    };
    expect(arg.data.updatedAt).toBeInstanceOf(Date);
  });

  it('toDto: trả updatedAt (ISO) để client gửi lại làm điều kiện tiên quyết', async () => {
    const { svc } = setup();
    const dto = await svc.update('w1', 'r9', { name: 'QA 2' }, 'u1');
    expect(dto.updatedAt).toBe('2026-10-20T03:00:00.000Z');
  });
});

describe('điều kiện tiên quyết expectedUpdatedAt (RC21, 184)', () => {
  it('khớp: so sánh-và-đặt trong transaction (updateMany theo id + updatedAt) rồi mới ghi', async () => {
    const { svc, prisma } = setup();
    await svc.update(
      'w1',
      'r9',
      { permissionKeys: ['issue:view'], expectedUpdatedAt: UPDATED_AT.toISOString() },
      'u1',
    );
    expect(prisma.role.updateMany).toHaveBeenCalledTimes(1);
    const arg = (prisma.role.updateMany.mock.calls[0] as unknown[])[0] as {
      where: { id: string; updatedAt: Date };
    };
    expect(arg.where.id).toBe('r9');
    expect(arg.where.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString());
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalled();
    expect(prisma.role.update).toHaveBeenCalled();
  });

  it('lệch (người khác vừa sửa) → 409 VERSION_CONFLICT, không xoá/ghi quyền, không làm mới RBAC, không phát sự kiện, không ghi nhật ký', async () => {
    const { svc, prisma, events, rbac, audit } = setup();
    prisma.role.updateMany.mockResolvedValueOnce({ count: 0 });
    const err = await svc
      .update(
        'w1',
        'r9',
        { permissionKeys: ['issue:view'], expectedUpdatedAt: '2026-10-20T02:00:00.000Z' },
        'u1',
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VersionConflictException);
    expect((err as VersionConflictException).getStatus()).toBe(409);
    expect((err as VersionConflictException).code).toBe('VERSION_CONFLICT');
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(prisma.role.update).not.toHaveBeenCalled();
    expect(rbac.invalidateWorkspace).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('không gửi expectedUpdatedAt (client cũ) → không kiểm, vẫn ghi như trước', async () => {
    const { svc, prisma } = setup();
    await svc.update('w1', 'r9', { permissionKeys: ['issue:view'] }, 'u1');
    expect(prisma.role.updateMany).not.toHaveBeenCalled();
    expect(prisma.role.update).toHaveBeenCalled();
  });

  it('schema: expectedUpdatedAt phải là ISO datetime', () => {
    expect(
      updateRoleSchema.safeParse({
        permissionKeys: [],
        expectedUpdatedAt: '2026-10-20T03:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(updateRoleSchema.safeParse({ expectedUpdatedAt: 'hôm qua' }).success).toBe(false);
    expect(updateRoleSchema.safeParse({ permissionKeys: [] }).success).toBe(true);
  });
});

describe('không để workspace mất quản trị viên cuối cùng qua sửa vai trò (phản chiếu members.assertNotLastWorkspaceAdmin)', () => {
  it('gỡ workspace:admin khỏi vai trò và không còn ai (đang hoạt động) giữ quyền này → 409 LAST_WORKSPACE_ADMIN, rollback', async () => {
    const { svc, prisma, events, rbac } = setup();
    prisma.rolePermission.count.mockResolvedValueOnce(1); // vai trò đang có workspace:admin
    prisma.workspaceMembership.count.mockResolvedValueOnce(0); // sau khi gỡ: không còn quản trị viên
    const err = await svc
      .update('w1', 'r9', { permissionKeys: ['issue:view'] }, 'u1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictAppException);
    expect((err as ConflictAppException).code).toBe('LAST_WORKSPACE_ADMIN');
    expect((err as ConflictAppException).getStatus()).toBe(409);
    expect(events.emit).not.toHaveBeenCalled();
    expect(rbac.invalidateWorkspace).not.toHaveBeenCalled();
    const where = (prisma.workspaceMembership.count.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({
      workspaceId: 'w1',
      user: { status: { not: 'DEACTIVATED' } },
    });
  });

  it('còn quản trị viên khác (vai trò hệ thống Workspace Admin) → cho gỡ', async () => {
    const { svc, prisma } = setup();
    prisma.rolePermission.count.mockResolvedValueOnce(1);
    prisma.workspaceMembership.count.mockResolvedValueOnce(2);
    await expect(
      svc.update('w1', 'r9', { permissionKeys: ['issue:view'] }, 'u1'),
    ).resolves.toBeTruthy();
  });

  it('vai trò vẫn giữ workspace:admin → không cần kiểm', async () => {
    const { svc, prisma } = setup();
    prisma.rolePermission.count.mockResolvedValueOnce(1);
    await svc.update('w1', 'r9', { permissionKeys: ['workspace:admin', 'issue:view'] }, 'u1');
    expect(prisma.workspaceMembership.count).not.toHaveBeenCalled();
  });

  it('vai trò vốn không có workspace:admin → không đếm quản trị viên', async () => {
    const { svc, prisma } = setup();
    await svc.update('w1', 'r9', { permissionKeys: ['issue:view'] }, 'u1');
    expect(prisma.workspaceMembership.count).not.toHaveBeenCalled();
  });
});
