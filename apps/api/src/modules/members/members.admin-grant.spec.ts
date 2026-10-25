import { describe, expect, it, vi } from 'vitest';
import { MembersService } from './members.service';

/**
 * P-C14: chỉ người đang giữ `workspace:admin` (hoặc admin hệ thống) mới cấp/gỡ vai trò mang `workspace:admin`.
 * Người chỉ có `member:manage` giữ nguyên mọi khả năng khác (đổi sang vai trò thường vẫn được).
 */
const ADMIN_ROLE = 'adminRole';
const MEMBER_ROLE = 'memberRole';
const OTHER_ROLE = 'otherRole';

const memberRow = {
  id: 'm2',
  joinedAt: new Date(),
  roleId: MEMBER_ROLE,
  role: { id: MEMBER_ROLE, name: 'Workspace Member', color: null },
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
  roles: [{ role: { id: MEMBER_ROLE, name: 'Workspace Member', color: null } }],
};

function setup(opts: {
  callerIsAdmin: boolean;
  currentRoleIds?: string[];
  targetIsAdmin?: boolean;
}) {
  const current = opts.currentRoleIds ?? [MEMBER_ROLE];
  const prisma = {
    user: {
      findUnique: vi.fn((_a?: unknown) =>
        Promise.resolve({
          id: 'u2',
          displayName: 'Bình',
          email: 'ba@x.vn',
          status: 'ACTIVE',
        } as { id: string; displayName: string; email: string; status: string } | null),
      ),
      findMany: vi.fn(() => Promise.resolve([{ id: 'u2', status: 'ACTIVE', email: 'ba@x.vn' }])),
    },
    role: {
      // validateRoles: mọi id yêu cầu đều hợp lệ
      findMany: vi.fn((args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(args.where.id.in.map((id) => ({ id }))),
      ),
      count: vi.fn(() => Promise.resolve(1)),
    },
    workspace: { findUnique: vi.fn(() => Promise.resolve({ ownerId: 'owner' })) },
    project: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1', name: 'Dự án', isPrivate: false })),
      findMany: vi.fn(() => Promise.resolve([] as unknown[])),
    },
    workspaceMembership: {
      count: vi.fn((_a?: unknown) => Promise.resolve(opts.targetIsAdmin ? 1 : 0)),
      findUnique: vi.fn((_a?: unknown) =>
        Promise.resolve({
          id: 'm2',
          roleId: current[0],
          roles: current.map((roleId) => ({ roleId })),
        }),
      ),
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({ count: 1 })),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(memberRow)),
    },
    workspaceMembershipRole: {
      deleteMany: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({})),
    },
    projectMembership: {
      findUnique: vi.fn((_a?: unknown) =>
        Promise.resolve({
          id: 'pm1',
          roleId: current[0],
          roles: current.map((roleId) => ({ roleId })),
        }),
      ),
      findMany: vi.fn(() => Promise.resolve([])),
      count: vi.fn(() => Promise.resolve(2)),
      create: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({ count: 1 })),
      update: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...memberRow, id: 'pm1' })),
    },
    projectMembershipRole: {
      deleteMany: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({})),
    },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function'
        ? Promise.resolve(
            (arg as (t: unknown) => unknown)({
              workspaceMembership: {
                createMany: vi.fn(() => Promise.resolve({ count: 1 })),
                findMany: vi.fn(() => Promise.resolve([{ id: 'm9' }])),
                delete: vi.fn(() => Promise.resolve({})),
              },
              workspaceMembershipRole: { createMany: vi.fn(() => Promise.resolve({})) },
              projectMembership: {
                createMany: vi.fn(() => Promise.resolve({ count: 1 })),
                findMany: vi.fn(() => Promise.resolve([{ id: 'pm9' }])),
                deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
              },
              projectMembershipRole: { createMany: vi.fn(() => Promise.resolve({})) },
              user: { create: vi.fn(() => Promise.resolve({ id: 'newU' })) },
            }),
          )
        : Promise.resolve([]),
    ),
  };
  const rbac = {
    invalidate: vi.fn(() => Promise.resolve()),
    invalidateWorkspace: vi.fn(() => Promise.resolve()),
    holdsWorkspaceAdmin: vi.fn((_u: string, _w: string) => Promise.resolve(opts.callerIsAdmin)),
    adminRoleIds: vi.fn((ids: readonly string[]) =>
      Promise.resolve(new Set(ids.filter((i) => i === ADMIN_ROLE))),
    ),
  };
  const svc = new MembersService(
    prisma as never,
    rbac as never,
    { revokeAllForUser: vi.fn(() => Promise.resolve([])), dropCaches: vi.fn() } as never,
    { emit: vi.fn() } as never,
    { record: vi.fn() } as never,
  );
  return { svc, prisma, rbac };
}

const DENIED = {
  status: 403,
  response: expect.objectContaining({ code: 'ADMIN_GRANT_REQUIRES_ADMIN' }) as unknown,
};

describe('MembersService — chỉ quản trị mới cấp/gỡ workspace:admin (P-C14)', () => {
  describe('người chỉ có member:manage (không phải quản trị) bị từ chối', () => {
    it('PUT roles: THÊM vai trò quản trị', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false });
      await expect(
        svc.setWorkspaceRoles('w1', 'u2', [MEMBER_ROLE, ADMIN_ROLE], 'caller'),
      ).rejects.toMatchObject(DENIED);
      expect(prisma.workspaceMembershipRole.deleteMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('PUT roles: GỠ vai trò quản trị khỏi người đang là quản trị', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false, currentRoleIds: [ADMIN_ROLE] });
      await expect(
        svc.setWorkspaceRoles('w1', 'u2', [MEMBER_ROLE], 'caller'),
      ).rejects.toMatchObject(DENIED);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('thêm thành viên (POST /members) với vai trò quản trị', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false });
      prisma.workspaceMembership.findUnique.mockResolvedValue(null as never);
      await expect(svc.addWorkspace('w1', 'u2', [ADMIN_ROLE], 'caller')).rejects.toMatchObject(
        DENIED,
      );
      expect(prisma.workspaceMembership.create).not.toHaveBeenCalled();
    });

    it('thêm hàng loạt (POST /members/bulk) với vai trò quản trị', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false });
      await expect(
        svc.addWorkspaceMany('w1', ['u2'], [MEMBER_ROLE, ADMIN_ROLE], 'caller'),
      ).rejects.toMatchObject(DENIED);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('tạo tài khoản (POST /members/accounts) với vai trò quản trị', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false });
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        svc.createAccount('w1', 'caller', {
          email: 'new@x.vn',
          displayName: 'Mới',
          roleIds: [ADMIN_ROLE],
        }),
      ).rejects.toMatchObject(DENIED);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('gỡ một quản trị khỏi không gian làm việc (DELETE /members/:id)', async () => {
      const { svc, prisma } = setup({
        callerIsAdmin: false,
        targetIsAdmin: true,
        currentRoleIds: [ADMIN_ROLE],
      });
      // còn quản trị khác nên không dính chốt "quản trị cuối cùng"
      await expect(svc.removeWorkspace('w1', 'u2', 'caller')).rejects.toMatchObject(DENIED);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('dự án: đặt/thêm vai trò dự án mang workspace:admin, và gỡ ghi đè đang giữ nó', async () => {
      const a = setup({ callerIsAdmin: false });
      await expect(
        a.svc.setProjectRoles('w1', 'p1', 'u2', [ADMIN_ROLE], 'caller'),
      ).rejects.toMatchObject(DENIED);
      const b = setup({ callerIsAdmin: false });
      b.prisma.projectMembership.findUnique.mockResolvedValue(null as never);
      await expect(
        b.svc.addProject('w1', 'p1', 'u2', [ADMIN_ROLE], 'caller'),
      ).rejects.toMatchObject(DENIED);
      const c = setup({ callerIsAdmin: false });
      await expect(
        c.svc.addProjectMany('w1', 'p1', ['u2'], [ADMIN_ROLE], 'caller'),
      ).rejects.toMatchObject(DENIED);
      const d = setup({ callerIsAdmin: false, currentRoleIds: [ADMIN_ROLE] });
      await expect(d.svc.clearProjectOverride('w1', 'p1', 'u2', 'caller')).rejects.toMatchObject(
        DENIED,
      );
      expect(d.prisma.projectMembership.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('người chỉ có member:manage vẫn làm được mọi việc không đụng quản trị', () => {
    it('đổi sang vai trò thường khác, giữ nguyên quản trị không có → qua', async () => {
      const { svc, prisma } = setup({ callerIsAdmin: false });
      await expect(
        svc.setWorkspaceRoles('w1', 'u2', [OTHER_ROLE], 'caller'),
      ).resolves.toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('thêm hàng loạt/thành viên/tài khoản với vai trò thường → qua', async () => {
      const a = setup({ callerIsAdmin: false });
      await expect(
        a.svc.addWorkspaceMany('w1', ['u2'], [MEMBER_ROLE], 'caller'),
      ).resolves.toMatchObject({ added: 1 });
      const b = setup({ callerIsAdmin: false });
      b.prisma.workspaceMembership.findUnique.mockResolvedValue(null as never);
      await expect(b.svc.addWorkspace('w1', 'u2', [MEMBER_ROLE], 'caller')).resolves.toBeDefined();
    });

    it('gỡ một thành viên thường → qua', async () => {
      const { svc } = setup({ callerIsAdmin: false });
      await expect(svc.removeWorkspace('w1', 'u2', 'caller')).resolves.toEqual({ success: true });
    });

    it('giữ nguyên vai trò quản trị của người đang là quản trị (chỉ thêm vai trò thường) → qua', async () => {
      const { svc } = setup({ callerIsAdmin: false, currentRoleIds: [ADMIN_ROLE] });
      await expect(
        svc.setWorkspaceRoles('w1', 'u2', [ADMIN_ROLE, OTHER_ROLE], 'caller'),
      ).resolves.toBeDefined();
    });
  });

  describe('quản trị workspace / admin hệ thống được phép', () => {
    it('cấp và gỡ vai trò quản trị; chỉ hỏi quyền người gọi MỘT lần (không tra DB vai trò)', async () => {
      const { svc, rbac } = setup({ callerIsAdmin: true });
      await expect(
        svc.setWorkspaceRoles('w1', 'u2', [MEMBER_ROLE, ADMIN_ROLE], 'admin'),
      ).resolves.toBeDefined();
      expect(rbac.holdsWorkspaceAdmin).toHaveBeenCalledWith('admin', 'w1');
      expect(rbac.adminRoleIds).not.toHaveBeenCalled();
      const b = setup({ callerIsAdmin: true, currentRoleIds: [ADMIN_ROLE] });
      await expect(
        b.svc.setWorkspaceRoles('w1', 'u2', [MEMBER_ROLE], 'admin'),
      ).resolves.toBeDefined();
    });
  });

  it('gọi nội bộ không có người gọi (seed, đăng ký, nhóm) → không áp luật', async () => {
    const { svc, rbac } = setup({ callerIsAdmin: false });
    await expect(svc.setWorkspaceRoles('w1', 'u2', [ADMIN_ROLE])).resolves.toBeDefined();
    expect(rbac.holdsWorkspaceAdmin).not.toHaveBeenCalled();
  });
});
