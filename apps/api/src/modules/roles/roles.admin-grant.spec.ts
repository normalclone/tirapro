import { describe, expect, it, vi } from 'vitest';
import { RolesService } from './roles.service';

/**
 * P-C14: tạo/sửa/nhân bản vai trò có (hoặc đang có) `workspace:admin` chỉ dành cho người đang giữ `workspace:admin`
 * hoặc admin hệ thống. Nhân bản = POST /roles với bộ quyền của bản gốc nên đi cùng đường `create`.
 * Quyết định: sửa BẤT KỲ phần nào (kể cả tên, quyền khác) của vai trò đang mang workspace:admin cũng cần quản trị, vì nó
 * đổi quyền của mọi quản trị đang giữ vai trò đó.
 */
const ADMIN = 'workspace:admin';
const UPDATED_AT = new Date('2026-10-20T03:00:00.000Z');
const roleRow = (keys: string[]) => ({
  id: 'r9',
  workspaceId: 'w1',
  name: 'QA',
  scope: 'WORKSPACE',
  isSystem: false,
  description: null,
  color: null,
  updatedAt: UPDATED_AT,
  permissions: keys.map((key) => ({ permission: { key } })),
  _count: { wsMembershipRoles: 0, projMembershipRoles: 0 },
});

function setup(opts: { callerIsAdmin: boolean; roleHasAdmin?: boolean }) {
  const prisma = {
    role: {
      create: vi.fn(() => Promise.resolve(roleRow([]))),
      update: vi.fn(() => Promise.resolve(roleRow([]))),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
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
      // vai trò hiện có workspace:admin? (cả đường "đang có" lẫn đường "gỡ" đều hỏi đếm này)
      count: vi.fn(() => Promise.resolve(opts.roleHasAdmin ? 1 : 0)),
    },
    workspaceMembership: { count: vi.fn(() => Promise.resolve(1)) },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const rbac = {
    invalidateWorkspace: vi.fn(() => Promise.resolve()),
    holdsWorkspaceAdmin: vi.fn((_u: string, _w: string) => Promise.resolve(opts.callerIsAdmin)),
  };
  const svc = new RolesService(
    prisma as never,
    rbac as never,
    { record: vi.fn() } as never,
    { emit: vi.fn() } as never,
  );
  return { svc, prisma, rbac };
}

const DENIED = {
  status: 403,
  response: expect.objectContaining({ code: 'ADMIN_GRANT_REQUIRES_ADMIN' }) as unknown,
};
const body = (permissionKeys: string[]) =>
  ({ name: 'Mới', scope: 'WORKSPACE', permissionKeys }) as never;

describe('RolesService — chỉ quản trị mới cấp/gỡ workspace:admin qua vai trò (P-C14)', () => {
  describe('người chỉ có member:manage bị từ chối', () => {
    it('tạo vai trò có workspace:admin', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false });
      await expect(svc.create('w1', body(['issue:view', ADMIN]), 'caller')).rejects.toMatchObject(
        DENIED,
      );
      expect(prisma.role.create).not.toHaveBeenCalled();
    });

    it('nhân bản (POST /roles với bộ quyền của vai trò quản trị)', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false });
      await expect(
        svc.create('w1', body([ADMIN, 'member:manage']), 'caller'),
      ).rejects.toMatchObject(DENIED);
      expect(prisma.role.create).not.toHaveBeenCalled();
    });

    it('sửa vai trò: THÊM workspace:admin', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false, roleHasAdmin: false });
      await expect(
        svc.update('w1', 'r9', { permissionKeys: ['issue:view', ADMIN] }, 'caller'),
      ).rejects.toMatchObject(DENIED);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('sửa vai trò: GỠ workspace:admin', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false, roleHasAdmin: true });
      await expect(
        svc.update('w1', 'r9', { permissionKeys: ['issue:view'] }, 'caller'),
      ).rejects.toMatchObject(DENIED);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('sửa quyền KHÁC (hoặc đổi tên) của vai trò đang có workspace:admin — yêu cầu quản trị (quyết định chặt)', async () => {
      const a = setup({ callerIsAdmin: false, roleHasAdmin: true });
      await expect(
        a.svc.update('w1', 'r9', { permissionKeys: [ADMIN, 'issue:view'] }, 'caller'),
      ).rejects.toMatchObject(DENIED);
      const b = setup({ callerIsAdmin: false, roleHasAdmin: true });
      await expect(b.svc.update('w1', 'r9', { name: 'Đổi tên' }, 'caller')).rejects.toMatchObject(
        DENIED,
      );
    });
  });

  describe('người chỉ có member:manage vẫn làm được việc không đụng quản trị', () => {
    it('tạo vai trò không có workspace:admin', async () => {
      const { svc, prisma, rbac } = setup({ callerIsAdmin: false });
      await expect(svc.create('w1', body(['issue:view']), 'caller')).resolves.toBeDefined();
      expect(prisma.role.create).toHaveBeenCalled();
      // không có khoá quản trị → không cần hỏi quyền người gọi
      expect(rbac.holdsWorkspaceAdmin).not.toHaveBeenCalled();
    });

    it('sửa vai trò không có workspace:admin (đổi bộ quyền thường, tên, mô tả)', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false, roleHasAdmin: false });
      await expect(
        svc.update('w1', 'r9', { permissionKeys: ['issue:view', 'issue:edit'] }, 'caller'),
      ).resolves.toBeDefined();
      await expect(svc.update('w1', 'r9', { name: 'QA 2' }, 'caller')).resolves.toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('quản trị workspace / admin hệ thống được phép', () => {
    it('tạo, thêm, gỡ và sửa vai trò đang có workspace:admin', async () => {
      const a = setup({ callerIsAdmin: true });
      await expect(a.svc.create('w1', body([ADMIN]), 'admin')).resolves.toBeDefined();
      expect(a.rbac.holdsWorkspaceAdmin).toHaveBeenCalledWith('admin', 'w1');
      const b = setup({ callerIsAdmin: true, roleHasAdmin: false });
      await expect(
        b.svc.update('w1', 'r9', { permissionKeys: [ADMIN] }, 'admin'),
      ).resolves.toBeDefined();
      const c = setup({ callerIsAdmin: true, roleHasAdmin: true });
      await expect(
        c.svc.update('w1', 'r9', { name: 'Quản trị 2' }, 'admin'),
      ).resolves.toBeDefined();
    });
  });
});
